import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  Prisma,
  advance_status,
  doc_type,
  documents,
} from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { toDecimal } from '../common/decimal';
import { CreditRepository } from '../credit/credit.repository';
import { CustomersService } from '../customers/customers.service';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesRepository } from '../sales/sales.repository';
import { allocatePayment } from './allocation';
import { CreateCustomerPaymentDto } from './dto/customer-payment.dto';

const ZERO = new Prisma.Decimal(0);

/**
 * Customer payment (PAY) and its allocation (§16-А).
 *
 * A payment is never a lump sum against "the customer": §16-А records which
 * sale each som closed, because §23.2's bonus rule and every debt report read
 * that. The default is oldest-first (§16-А.1); a cashier may direct it
 * (§16-А.2); anything beyond the debts becomes an advance (§16-А.5).
 */
@Injectable()
export class CustomerPaymentsService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.PAY;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly customers: CustomersService,
    private readonly sales: SalesRepository,
    private readonly credit: CreditRepository,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  async create(
    dto: CreateCustomerPaymentDto,
    userId: string,
  ): Promise<documents> {
    const customer = await this.customers.findOne(dto.customer_id);

    const lines = dto.lines.map((line, index) => ({
      accountId: line.account_id,
      amount: toDecimal(line.amount, `lines[${index}].amount`),
    }));
    const total = lines.reduce((sum, line) => sum.plus(line.amount), ZERO);
    if (total.lessThanOrEqualTo(0)) {
      throw new BadRequestException('A payment must be greater than zero');
    }

    for (const [index, line] of lines.entries()) {
      if (line.amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          `lines[${index}].amount must be greater than zero`,
        );
      }
      const account = await this.accounts.findOne(line.accountId);
      if (!account.is_active) {
        throw new BadRequestException(`${account.name} эсеби активдүү эмес`);
      }
      if (account.currency !== 'KGS') {
        throw new BadRequestException(
          `${account.name} ${account.currency} эсеби — кардар төлөмү сом менен`,
        );
      }
    }

    // §11.1.2: Walk-in carries no debt, so there is nothing to pay off and an
    // overpayment could not become an advance either.
    if (customer.is_walk_in) {
      throw this.customers.walkInRefusal('DEBT');
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.PAY,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await tx.customer_payments.create({
        data: {
          document_id: document.id,
          customer_id: dto.customer_id,
          total_amount: total,
        },
      });
      await tx.customer_payment_lines.createMany({
        data: lines.map((line) => ({
          payment_id: document.id,
          account_id: line.accountId,
          amount: line.amount,
        })),
      });

      if (dto.allocations?.length) {
        // Stored on the document so the confirm applies exactly what the
        // cashier chose (§16-А.2), not what the debts look like later.
        await tx.audit_log.create({
          data: {
            user_id: userId,
            document_id: document.id,
            entity: 'customer_payments',
            entity_id: document.id,
            action: 'PAYMENT_MANUAL_ALLOCATION_REQUESTED',
            new_value: {
              allocations: dto.allocations.map((a) => ({
                sale_id: a.sale_id,
                amount: a.amount,
              })),
            },
          },
        });
      }

      return document;
    });
  }

  /**
   * Posting the payment: money in, debts closed, any surplus banked as an
   * advance — all in one transaction (§16-А).
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const payment = await tx.customer_payments.findUnique({
      where: { document_id: document.id },
      include: {
        customer_payment_lines: true,
        customers: true,
      },
    });
    if (!payment) {
      throw new NotFoundException(
        `Customer payment body missing for ${document.doc_number}`,
      );
    }

    // The debts are locked before they are read, so a concurrent sale or
    // payment cannot change what this one is allocating against.
    const debts = await this.credit.lockOpenDebts(tx, payment.customer_id);
    const manual = await this.manualAllocations(tx, document.id);

    const outcome = allocatePayment({
      amount: payment.total_amount,
      debts: debts.map((debt) => ({
        saleId: debt.sale_id,
        docNumber: debt.doc_number,
        outstanding: debt.outstanding_amount,
      })),
      manual,
    });

    for (const line of outcome.lines) {
      await tx.payment_allocations.create({
        data: {
          payment_id: document.id,
          sale_id: line.saleId,
          amount: line.amount,
          is_manual: line.isManual,
        },
      });
      // The only way a sale's paid and outstanding amounts ever move.
      await this.sales.applyAllocation(tx, line.saleId, line.amount);
    }

    for (const line of payment.customer_payment_lines) {
      const { account, balance } = await this.accounts.lockBalance(
        tx,
        line.account_id,
      );
      await this.accounts.postMovement(tx, {
        accountId: line.account_id,
        documentId: document.id,
        amount: line.amount,
        kgsValue: null,
        currentBalance: balance,
        accountName: account.name,
      });
    }

    let advanceId: string | null = null;
    if (outcome.overpayment.greaterThan(0)) {
      advanceId = await this.bankOverpayment(tx, {
        document,
        customerId: payment.customer_id,
        accountId: payment.customer_payment_lines[0].account_id,
        amount: outcome.overpayment,
        userId,
      });
    }

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'customer_payments',
        entityId: document.id,
        action: 'CUSTOMER_PAYMENT_POSTED',
        newValue: {
          customer_id: payment.customer_id,
          total_amount: payment.total_amount.toFixed(2),
          allocations: outcome.lines.map((line) => ({
            sale_id: line.saleId,
            doc_number: debts.find((d) => d.sale_id === line.saleId)?.doc_number,
            amount: line.amount.toFixed(2),
            is_manual: line.isManual,
          })),
          overpayment: outcome.overpayment.toFixed(2),
          advance_document_id: advanceId,
        },
      },
      tx,
    );
  }

  /**
   * Turns an overpayment into a customer advance (§16-А.5).
   *
   * The money does not vanish and does not become "unexplained cash": it is a
   * liability to the customer, held as an ACTIVE advance until a later sale
   * uses it or it is refunded (Module 5).
   */
  private async bankOverpayment(
    tx: Prisma.TransactionClient,
    params: {
      document: documents;
      customerId: string;
      accountId: string;
      amount: Prisma.Decimal;
      userId: string;
    },
  ): Promise<string> {
    const advanceDocument = await this.documents.create(tx, {
      docType: doc_type.ADV,
      businessDate: params.document.business_date,
      userId: params.userId,
      comment: `${params.document.doc_number} боюнча ашыкча төлөм (§16-А.5)`,
    });
    await this.documents.markConfirmedWithoutPosting(tx, advanceDocument.id);

    await tx.advances.create({
      data: {
        document_id: advanceDocument.id,
        customer_id: params.customerId,
        from_payment_id: params.document.id,
        account_id: params.accountId,
        amount: params.amount,
        astatus: advance_status.ACTIVE,
      },
    });

    await tx.customer_payments.update({
      where: { document_id: params.document.id },
      data: { overpay_advance_doc: advanceDocument.id },
    });

    return advanceDocument.id;
  }

  /** The cashier's chosen split, as recorded when the payment was created. */
  private async manualAllocations(
    tx: Prisma.TransactionClient,
    paymentId: string,
  ): Promise<{ saleId: string; amount: Prisma.Decimal }[]> {
    const entry = await tx.audit_log.findFirst({
      where: {
        document_id: paymentId,
        action: 'PAYMENT_MANUAL_ALLOCATION_REQUESTED',
      },
      orderBy: { id: 'desc' },
    });
    if (!entry?.new_value) {
      return [];
    }

    const value = entry.new_value as {
      allocations?: { sale_id: string; amount: string }[];
    };
    return (value.allocations ?? []).map((row) => ({
      saleId: row.sale_id,
      amount: new Prisma.Decimal(row.amount),
    }));
  }

  async findOne(documentId: string, db: Db = this.prisma) {
    const payment = await db.customer_payments.findUnique({
      where: { document_id: documentId },
      include: {
        customer_payment_lines: { include: { payment_accounts: true } },
        payment_allocations: true,
        customers: { select: { id: true, name: true } },
        documents_customer_payments_document_idTodocuments: {
          select: { doc_number: true, business_date: true, status: true },
        },
      },
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    return payment;
  }

  findMany(filter: { customerId?: string; limit?: number }) {
    return this.prisma.customer_payments.findMany({
      where: { ...(filter.customerId ? { customer_id: filter.customerId } : {}) },
      include: {
        payment_allocations: true,
        customers: { select: { id: true, name: true } },
        documents_customer_payments_document_idTodocuments: {
          select: { doc_number: true, business_date: true, status: true },
        },
      },
      orderBy: {
        documents_customer_payments_document_idTodocuments: { created_at: 'desc' },
      },
      take: Math.min(filter.limit ?? 50, 200),
    });
  }

  /** Advances the customer is holding with us (§16-А.5, §17-А). */
  advancesFor(customerId: string, db: Db = this.prisma) {
    return db.advances.findMany({
      where: { customer_id: customerId },
      include: {
        documents_advances_document_idTodocuments: {
          select: { doc_number: true, business_date: true },
        },
      },
      orderBy: { document_id: 'asc' },
    });
  }
}

export { ConflictException };
