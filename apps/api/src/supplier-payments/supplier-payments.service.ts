import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, currency_code, doc_type, documents } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { toDecimal } from '../common/decimal';
import { SuppliersService } from '../counterparties/counterparties.service';
import { CurrencyFifoService } from '../currency/currency-fifo.service';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { SupplierLedgerService, splitAgainstDebt } from '../ledgers/ledgers.service';
import { PrismaService } from '../prisma/prisma.service';
import { PurchasesService } from '../purchases/purchases.service';
import { CreateSupplierPaymentDto } from './dto/supplier-payment.dto';
import { SupplierPaymentsRepository } from './supplier-payments.repository';

const ZERO = new Prisma.Decimal(0);

/**
 * Supplier Payment (SPY) — §4.1, §4.3, §10.2.
 *
 * Yuan leaves a currency till and settles what we owe the Chinese supplier.
 * Three things happen at once and must agree:
 *
 *   - the currency FIFO says what those yuan actually cost in KGS (§10-А.3);
 *   - the ledger says how much of the payment closes debt and how much
 *     becomes an advance (§4.3);
 *   - the difference between what the debt was booked at and what the yuan
 *     cost is the exchange result (§10.2) — a financial gain or loss, never
 *     part of the goods' cost.
 */
@Injectable()
export class SupplierPaymentsService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.SPY;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly repository: SupplierPaymentsRepository,
    private readonly suppliers: SuppliersService,
    private readonly purchases: PurchasesService,
    private readonly accounts: AccountsService,
    private readonly fifo: CurrencyFifoService,
    private readonly ledger: SupplierLedgerService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  async create(
    dto: CreateSupplierPaymentDto,
    userId: string,
  ): Promise<documents> {
    const amount = toDecimal(dto.amount_cny, 'amount_cny');
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('amount_cny must be greater than zero');
    }

    await this.suppliers.findOne(dto.supplier_id);

    const account = await this.accounts.findOptional(dto.from_account);
    if (!account) {
      throw new NotFoundException('from_account does not exist');
    }
    if (account.currency !== currency_code.CNY) {
      throw new BadRequestException(
        `A supplier payment leaves a CNY till; ${account.name} holds ${account.currency} (§4.1)`,
      );
    }
    if (!account.is_active) {
      throw new BadRequestException('The account must be active');
    }

    if (dto.purchase_id) {
      await this.purchases.assertBelongsToSupplier(
        dto.purchase_id,
        dto.supplier_id,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.SPY,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await this.repository.insert(tx, {
        documentId: document.id,
        supplierId: dto.supplier_id,
        fromAccount: dto.from_account,
        amountCny: amount,
        purchaseId: dto.purchase_id ?? null,
        channel: dto.channel ?? null,
      });

      return document;
    });
  }

  /**
   * Posts the payment. Everything below is one transaction: if the till turns
   * out to be short, nothing at all is written (§10-А.4).
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const payment = await this.repository.findByDocument(tx, document.id);
    if (!payment) {
      throw new NotFoundException(
        `Supplier payment body missing for ${document.doc_number}`,
      );
    }

    const { account, balance } = await this.accounts.lockBalance(
      tx,
      payment.from_account,
    );

    // Checked up front so the message names the payment, not whichever part
    // of it happened to run out of layers.
    if (balance.lessThan(payment.amount_cny)) {
      throw new ConflictException(
        `${account.name} holds ${balance.toFixed(2)} CNY, which is not enough for ` +
          `${payment.amount_cny.toFixed(2)}; buy currency first (CEX)`,
      );
    }

    const open = await this.ledger.openDebt(tx, payment.supplier_id);
    const split = splitAgainstDebt(payment.amount_cny, open);

    // Consumed in two steps so each part carries the cost of the layers it
    // actually used: the debt is settled from the oldest yuan, the advance
    // from what is left.
    const debtConsumption = split.debtPart.greaterThan(0)
      ? await this.fifo.consumeCurrency(tx, {
          accountId: payment.from_account,
          amount: split.debtPart,
          documentId: document.id,
          accountName: account.name,
        })
      : null;

    const prepayConsumption = split.prepayPart.greaterThan(0)
      ? await this.fifo.consumeCurrency(tx, {
          accountId: payment.from_account,
          amount: split.prepayPart,
          documentId: document.id,
          accountName: account.name,
        })
      : null;

    const debtActualKgs = debtConsumption?.kgsValue ?? ZERO;
    const prepayActualKgs = prepayConsumption?.kgsValue ?? ZERO;
    const totalKgs = debtActualKgs.plus(prepayActualKgs);

    // §10.2: what the debt was booked at, less what settling it actually
    // cost. Negative is a loss. The advance is carried at cost, so it
    // produces no result of its own.
    const fxGainLoss = split.debtRecognisedKgs.minus(debtActualKgs);

    await this.ledger.recordPayment(tx, {
      supplierId: payment.supplier_id,
      documentId: document.id,
      split,
      prepayActualKgs,
    });

    await this.accounts.postMovement(tx, {
      accountId: payment.from_account,
      documentId: document.id,
      amount: payment.amount_cny.negated(),
      kgsValue: totalKgs.negated(),
      currentBalance: balance,
      accountName: account.name,
    });

    await this.repository.recordPosting(tx, document.id, {
      kgsValue: totalKgs,
      debtPartCny: split.debtPart,
      prepayPartCny: split.prepayPart,
      fxGainLossKgs: fxGainLoss,
    });

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'supplier_payments',
        entityId: document.id,
        action: 'SUPPLIER_PAYMENT_POSTED',
        newValue: {
          supplier_id: payment.supplier_id,
          purchase_id: payment.purchase_id,
          amount_cny: payment.amount_cny.toFixed(2),
          debt_part_cny: split.debtPart.toFixed(2),
          prepay_part_cny: split.prepayPart.toFixed(2),
          debt_recognised_kgs: split.debtRecognisedKgs.toFixed(2),
          paid_kgs: totalKgs.toFixed(2),
          fx_gain_loss_kgs: fxGainLoss.toFixed(2),
        },
      },
      tx,
    );
  }

}
