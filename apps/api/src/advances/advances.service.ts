import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, advance_status, doc_type, documents } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { Db } from '../common/db';
import { toDecimal } from '../common/decimal';
import { CreditRepository } from '../credit/credit.repository';
import { allocatePayment } from '../customer-payments/allocation';
import { CustomersService } from '../customers/customers.service';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesRepository } from '../sales/sales.repository';
import { AdvanceFull, AdvancesRepository } from './advances.repository';
import { CreateAdvanceDto, RefundAdvanceDto } from './dto/advance.dto';

const ZERO = new Prisma.Decimal(0);

/** How an advance stands right now (§17-А.6). */
export function remainingOf(advance: {
  amount: Prisma.Decimal;
  applied_amount: Prisma.Decimal;
  refunded_amount: Prisma.Decimal;
}): Prisma.Decimal {
  return advance.amount
    .minus(advance.applied_amount)
    .minus(advance.refunded_amount);
}

function statusFor(advance: {
  amount: Prisma.Decimal;
  applied_amount: Prisma.Decimal;
  refunded_amount: Prisma.Decimal;
}): advance_status {
  if (remainingOf(advance).lessThanOrEqualTo(ZERO)) {
    return advance.refunded_amount.greaterThan(ZERO) &&
      advance.applied_amount.lessThanOrEqualTo(ZERO)
      ? advance_status.REFUNDED
      : advance_status.APPLIED;
  }
  return advance.applied_amount.greaterThan(ZERO)
    ? advance_status.PARTIALLY_APPLIED
    : advance_status.ACTIVE;
}

/**
 * Customer advance (ADV) — §17-А.
 *
 * Money taken before the goods change hands is not revenue: it increases cash
 * and, by the same amount, what the business owes the customer. Revenue and
 * COGS wait for the sale (§17-А.1). Everything here is about that liability —
 * taking it on, applying it to a sale, and giving it back.
 */
@Injectable()
export class AdvancesService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.ADV;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly repository: AdvancesRepository,
    private readonly customers: CustomersService,
    private readonly accounts: AccountsService,
    private readonly credit: CreditRepository,
    private readonly sales: SalesRepository,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  async create(dto: CreateAdvanceDto, userId: string): Promise<documents> {
    const customer = await this.customers.findOne(dto.customer_id);
    if (customer.is_walk_in) {
      // §17.3: "Walk-in Customer үчүн Reservation жана Advance колдонулбайт".
      throw this.customers.walkInRefusal('ADVANCE');
    }
    if (!customer.is_active) {
      throw new BadRequestException('Кардар активдүү эмес');
    }

    const amount = toDecimal(dto.amount, 'amount');
    if (amount.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException('Аванс оң сумма болушу керек');
    }

    const account = await this.accounts.findOne(dto.account_id);
    if (!account.is_active) {
      throw new BadRequestException(`${account.name} эсеби активдүү эмес`);
    }
    if (account.currency !== 'KGS') {
      throw new BadRequestException(
        `${account.name} — ${account.currency} эсеби; кардардын авансы сом менен алынат`,
      );
    }

    if (dto.reservation_id) {
      const reservation = await this.prisma.reservations.findUnique({
        where: { document_id: dto.reservation_id },
        select: { customer_id: true },
      });
      if (!reservation) {
        throw new NotFoundException('Бронь табылган жок');
      }
      if (reservation.customer_id !== customer.id) {
        throw new ConflictException(
          'Бул бронь башка кардардыкы — аванс ага байланбайт (§17-А.6)',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.ADV,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await this.repository.insert(tx, {
        documentId: document.id,
        customerId: customer.id,
        reservationId: dto.reservation_id ?? null,
        accountId: dto.account_id,
        amount,
      });

      return document;
    });
  }

  /**
   * Posting takes the money in and records the liability (§17-А.1).
   *
   * No revenue, no COGS: the goods have not moved. The account movement is
   * the only thing that happens here.
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const advance = await this.requireAdvance(tx, document.id);

    const { account, balance } = await this.accounts.lockBalance(
      tx,
      advance.account_id,
    );
    await this.accounts.postMovement(tx, {
      accountId: advance.account_id,
      documentId: document.id,
      amount: advance.amount,
      kgsValue: null,
      currentBalance: balance,
      accountName: account.name,
    });

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'advances',
        entityId: document.id,
        action: 'ADVANCE_RECEIVED',
        newValue: {
          customer_id: advance.customer_id,
          reservation_id: advance.reservation_id,
          amount: advance.amount.toFixed(2),
          account_id: advance.account_id,
        },
      },
      tx,
    );
  }

  /**
   * Spends the customer's advances on a sale (§17-А.2, §17-А.3).
   *
   * Oldest first, and never more than the sale still owes. The money is
   * already in the till — this converts a liability into revenue, so nothing
   * moves between accounts.
   */
  async applyToSale(
    tx: Prisma.TransactionClient,
    params: { customerId: string; saleId: string; upTo: Prisma.Decimal },
  ): Promise<{ applied: Prisma.Decimal; lines: { advanceId: string; amount: Prisma.Decimal }[] }> {
    if (params.upTo.lessThanOrEqualTo(ZERO)) {
      return { applied: ZERO, lines: [] };
    }

    const advances = await this.repository.liveFor(tx, params.customerId);
    let left = params.upTo;
    const lines: { advanceId: string; amount: Prisma.Decimal }[] = [];

    for (const advance of advances) {
      if (left.lessThanOrEqualTo(ZERO)) break;
      const remaining = remainingOf(advance);
      if (remaining.lessThanOrEqualTo(ZERO)) continue;

      const take = Prisma.Decimal.min(remaining, left);
      const applied = advance.applied_amount.plus(take);

      await this.repository.setAmounts(tx, advance.document_id, {
        appliedAmount: applied,
        status: statusFor({
          amount: advance.amount,
          applied_amount: applied,
          refunded_amount: advance.refunded_amount,
        }),
      });

      lines.push({ advanceId: advance.document_id, amount: take });
      left = left.minus(take);
    }

    const applied = params.upTo.minus(left);
    if (applied.greaterThan(ZERO)) {
      await this.audit.log(
        {
          userId: null,
          documentId: params.saleId,
          entity: 'advances',
          entityId: params.saleId,
          action: 'ADVANCE_APPLIED_TO_SALE',
          newValue: {
            sale_id: params.saleId,
            applied: applied.toFixed(2),
            lines: lines.map((line) => ({
              advance_id: line.advanceId,
              amount: line.amount.toFixed(2),
            })),
          },
        },
        tx,
      );
    }

    return { applied, lines };
  }

  /**
   * Gives an advance back (§17-А.4).
   *
   * Three rules apply in order: an open debt is settled first (§35.4), the
   * cash that remains leaves the accounts the caller names, each documented
   * (§35.5), and the whole thing takes a PIN because money is going out.
   */
  async refund(
    id: string,
    dto: RefundAdvanceDto,
    userId: string,
    ip?: string,
  ): Promise<AdvanceFull> {
    // §17-А.4: PIN first — before anything is read, let alone written.
    const { valid } = await this.auth.verifyPin(userId, dto.pin, {
      ip: ip ?? null,
      device: `advance-refund:${id}`,
    });
    if (!valid) {
      throw new UnprocessableEntityException({
        message: 'PIN туура эмес',
        code: 'PIN_INVALID',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const advance = await this.requireAdvance(tx, id);
      if (advance.documents_advances_document_idTodocuments.status !== 'CONFIRMED') {
        throw new ConflictException(
          'Тастыкталбаган аванс кайтарылбайт — адегенде документти тастыктаңыз',
        );
      }

      const available = remainingOf(advance);
      if (available.lessThanOrEqualTo(ZERO)) {
        throw new ConflictException(
          'Бул аванста кайтара турган калдык жок (§17-А.6)',
        );
      }

      // §35.4 — the customer's open debt is settled before any cash leaves.
      const debts = await this.credit.lockOpenDebts(tx, advance.customer_id);
      const offset = allocatePayment({
        amount: available,
        debts: debts.map((debt) => ({
          saleId: debt.sale_id,
          docNumber: debt.doc_number,
          outstanding: debt.outstanding_amount,
        })),
      });

      for (const line of offset.lines) {
        await this.sales.applyAllocation(tx, line.saleId, line.amount);
      }

      const cash = offset.overpayment;
      const requested = dto.lines.reduce(
        (sum, line) => sum.plus(toDecimal(line.amount, 'lines[].amount')),
        ZERO,
      );
      if (!requested.equals(cash)) {
        throw new UnprocessableEntityException({
          message:
            `Карыз жабылгандан кийин кайтарылчу сумма ${cash.toFixed(2)} сом ` +
            `(карызга ${offset.lines
              .reduce((sum, line) => sum.plus(line.amount), ZERO)
              .toFixed(2)} эсептелди) — берилген саптардын суммасы ${requested.toFixed(2)} (§35.4)`,
          code: 'REFUND_AMOUNT_MISMATCH',
          debt_offset: available.minus(cash).toFixed(2),
          cash_refund: cash.toFixed(2),
        });
      }

      const refundLines: {
        accountId: string | null;
        saleId: string | null;
        amount: Prisma.Decimal;
        sourceOverrideReason: string | null;
      }[] = offset.lines.map((line) => ({
        accountId: null,
        saleId: line.saleId,
        amount: line.amount,
        sourceOverrideReason: null,
      }));

      for (const line of dto.lines) {
        const amount = toDecimal(line.amount, 'lines[].amount');
        if (amount.lessThanOrEqualTo(ZERO)) {
          throw new BadRequestException('Кайтаруу суммасы оң болушу керек');
        }

        // §35.5 rule 4: leaving by another door is allowed, but it is stated.
        const isOriginal = line.account_id === advance.account_id;
        if (!isOriginal && !dto.source_override_reason?.trim()) {
          throw new UnprocessableEntityException({
            message:
              'Акча аванс түшкөн эсептен башка эсептен кайтарылып жатат — себеп милдеттүү (§35.5)',
            code: 'REFUND_SOURCE_OVERRIDE_REASON_REQUIRED',
          });
        }

        const { account, balance } = await this.accounts.lockBalance(
          tx,
          line.account_id,
        );
        await this.accounts.postMovement(tx, {
          accountId: line.account_id,
          documentId: advance.document_id,
          amount: amount.negated(),
          kgsValue: null,
          currentBalance: balance,
          accountName: account.name,
        });

        refundLines.push({
          accountId: line.account_id,
          saleId: null,
          amount,
          sourceOverrideReason: isOriginal
            ? null
            : (dto.source_override_reason?.trim() ?? null),
        });
      }

      await this.repository.insertRefundLines(tx, advance.document_id, refundLines);

      const refunded = advance.refunded_amount.plus(available);
      await this.repository.setAmounts(tx, advance.document_id, {
        refundedAmount: refunded,
        status: statusFor({
          amount: advance.amount,
          applied_amount: advance.applied_amount,
          refunded_amount: refunded,
        }),
      });

      await this.audit.log(
        {
          userId,
          documentId: advance.document_id,
          entity: 'advances',
          entityId: advance.document_id,
          action: 'ADVANCE_REFUNDED',
          oldValue: { refunded_amount: advance.refunded_amount.toFixed(2) },
          newValue: {
            refunded_amount: refunded.toFixed(2),
            debt_offset: available.minus(cash).toFixed(2),
            cash_refund: cash.toFixed(2),
            lines: refundLines.map((line) => ({
              account_id: line.accountId,
              sale_id: line.saleId,
              amount: line.amount.toFixed(2),
            })),
          },
          reason: dto.reason?.trim() ?? null,
        },
        tx,
      );

      return this.requireAdvance(tx, advance.document_id);
    });
  }

  listFor(customerId: string, db: Db = this.prisma): Promise<AdvanceFull[]> {
    return this.repository.liveFor(db, customerId);
  }

  findOne(id: string, db: Db = this.prisma): Promise<AdvanceFull> {
    return this.requireAdvance(db, id);
  }

  refundLines(id: string) {
    return this.repository.refundLines(this.prisma, id);
  }

  private async requireAdvance(db: Db, id: string): Promise<AdvanceFull> {
    const advance = await this.repository.findById(db, id);
    if (!advance) {
      throw new NotFoundException('Аванс табылган жок');
    }
    return advance;
  }
}
