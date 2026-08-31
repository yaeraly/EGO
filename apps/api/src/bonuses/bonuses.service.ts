import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  bonus_status,
  bonuses,
  doc_type,
  documents,
} from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db';
import { toOptionalDecimal } from '../common/decimal';
import { resolveBusinessDate } from '../documents/business-date';
import { DocumentPoster } from '../documents/document-poster';
import { DocumentPostingRegistry } from '../documents/document-posting.registry';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingKey } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import {
  bonusBase,
  calculatedBonus,
  payableAmount,
  returnedMargin,
} from './bonus-rules';
import { CreateBonusPaymentDto } from './dto/bonus.dto';

const ZERO = new Prisma.Decimal(0);

/**
 * Seller bonus (§23) and its payment (BON).
 *
 * Three moments, and they are deliberately separate:
 *
 *   the sale is confirmed  → the margin is known → CALCULATED (§23.1)
 *   that sale is paid off  → the money is real   → PAYABLE    (§23.2)
 *   the bonus is handed over                     → PAID       (§23.3)
 *
 * A customer's older debt on some *other* sale does not hold this one back —
 * §23.2 says so explicitly.
 */
@Injectable()
export class BonusesService implements DocumentPoster, OnModuleInit {
  readonly docType = doc_type.BON;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly accounts: AccountsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly posting: DocumentPostingRegistry,
  ) {}

  onModuleInit(): void {
    this.posting.register(this);
  }

  /**
   * Records what a confirmed sale earned (§23.1).
   *
   * Called from inside the sale's own confirming transaction, so the bonus
   * and the sale it belongs to commit together.
   */
  async calculateForSale(
    tx: Prisma.TransactionClient,
    params: {
      saleId: string;
      salesperson: string;
      revenue: Prisma.Decimal;
      fifoCogs: Prisma.Decimal;
      outstanding: Prisma.Decimal;
      isLossSale: boolean;
    },
  ): Promise<bonuses> {
    const rate = await this.rateFor(tx, params.salesperson);
    const base = bonusBase({
      revenue: params.revenue,
      fifoCogs: params.fifoCogs,
      isLossSale: params.isLossSale,
    });
    const calculated = calculatedBonus(base, rate);

    // §23.2 — a sale paid in full at the counter is payable straight away.
    const payable = params.outstanding.lessThanOrEqualTo(ZERO);

    return tx.bonuses.create({
      data: {
        sale_id: params.saleId,
        employee_id: params.salesperson,
        revenue: params.revenue,
        fifo_cogs: params.fifoCogs,
        bonus_base: base,
        bonus_rate: rate,
        calculated_amount: calculated,
        payable_amount: calculated,
        bstatus: payable ? bonus_status.PAYABLE : bonus_status.CALCULATED,
        ...(payable ? { payable_at: new Date() } : {}),
      },
    });
  }

  /**
   * Moves a bonus to PAYABLE once its own sale is settled (§23.2).
   *
   * Called wherever a sale's outstanding amount changes — a customer payment,
   * an advance refunded against the debt, a return that offsets it.
   */
  async reassess(
    tx: Prisma.TransactionClient,
    saleId: string,
  ): Promise<void> {
    const bonus = await tx.bonuses.findUnique({ where: { sale_id: saleId } });
    if (!bonus) {
      return;
    }
    // A bonus already paid is not re-opened by later movement; §23.4 handles
    // that case with an adjustment instead.
    if (
      bonus.bstatus === bonus_status.PAID ||
      bonus.bstatus === bonus_status.REVERSED
    ) {
      return;
    }

    const sale = await tx.sales.findUniqueOrThrow({
      where: { document_id: saleId },
      select: { outstanding_amount: true },
    });
    const settled = sale.outstanding_amount.lessThanOrEqualTo(ZERO);

    if (settled && bonus.bstatus === bonus_status.CALCULATED) {
      await tx.bonuses.update({
        where: { sale_id: saleId },
        data: { bstatus: bonus_status.PAYABLE, payable_at: new Date() },
      });
      return;
    }

    // Debt reopened by a correction: it is not payable again until settled.
    if (!settled && bonus.bstatus === bonus_status.PAYABLE) {
      await tx.bonuses.update({
        where: { sale_id: saleId },
        data: { bstatus: bonus_status.CALCULATED, payable_at: null },
      });
    }
  }

  /**
   * Takes back the bonus on goods that came back (§23.4).
   *
   * Not yet paid: the calculated figure is reduced, and a full return leaves
   * it REVERSED. Already paid: the payment stands and the difference is
   * carried as an adjustment, to be settled out of the next bonus.
   */
  async reverseForReturn(
    tx: Prisma.TransactionClient,
    params: {
      saleId: string;
      returnId: string;
      lines: {
        qty: Prisma.Decimal;
        unitPrice: Prisma.Decimal;
        unitCost: Prisma.Decimal;
      }[];
      userId: string;
    },
  ): Promise<void> {
    const bonus = await tx.bonuses.findUnique({
      where: { sale_id: params.saleId },
    });
    if (!bonus) {
      return;
    }

    const marginBack = params.lines.reduce(
      (sum, line) => sum.plus(returnedMargin(line)),
      ZERO,
    );
    if (marginBack.lessThanOrEqualTo(ZERO)) {
      return;
    }

    const bonusBack = calculatedBonus(marginBack, bonus.bonus_rate);
    if (bonusBack.lessThanOrEqualTo(ZERO)) {
      return;
    }

    const wasPaid = bonus.bstatus === bonus_status.PAID;
    const adjustment = bonus.adjustment_amount.plus(bonusBack);
    const payable = payableAmount(bonus.calculated_amount, adjustment);

    const status = wasPaid
      ? bonus_status.ADJUSTED
      : payable.lessThanOrEqualTo(ZERO)
        ? bonus_status.REVERSED
        : bonus.bstatus;

    await tx.bonuses.update({
      where: { sale_id: params.saleId },
      data: {
        adjustment_amount: adjustment,
        payable_amount: payable,
        bstatus: status,
      },
    });

    await this.audit.log(
      {
        userId: params.userId,
        documentId: params.returnId,
        entity: 'bonuses',
        entityId: bonus.id,
        action: wasPaid ? 'BONUS_ADJUSTED_AFTER_RETURN' : 'BONUS_REDUCED_BY_RETURN',
        oldValue: {
          adjustment_amount: bonus.adjustment_amount.toFixed(2),
          payable_amount: bonus.payable_amount.toFixed(2),
          status: bonus.bstatus,
        },
        newValue: {
          sale_id: params.saleId,
          return_id: params.returnId,
          margin_returned: marginBack.toFixed(2),
          bonus_returned: bonusBack.toFixed(2),
          adjustment_amount: adjustment.toFixed(2),
          payable_amount: payable.toFixed(2),
          status,
          // §23.4 — a paid bonus is never erased; the difference is carried.
          payment_kept: wasPaid,
        },
      },
      tx,
    );
  }

  // ── the payment (BON) ─────────────────────────────────────────────────

  async createPayment(
    dto: CreateBonusPaymentDto,
    userId: string,
  ): Promise<documents> {
    const account = await this.accounts.findOne(dto.account_id);
    if (!account.is_active) {
      throw new BadRequestException(`${account.name} эсеби активдүү эмес`);
    }
    if (account.currency !== 'KGS') {
      throw new BadRequestException(
        `${account.name} — ${account.currency} эсеби; бонус сом менен төлөнөт`,
      );
    }

    const due = await this.payableTotal(this.prisma, dto.employee_id);
    if (due.lessThanOrEqualTo(ZERO)) {
      throw new UnprocessableEntityException({
        message: 'Бул кызматкерде төлөнө турган бонус жок (§23.2)',
        code: 'NOTHING_PAYABLE',
      });
    }

    const amount = toOptionalDecimal(dto.amount, 'amount') ?? due;
    if (amount.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException('Сумма оң болушу керек');
    }
    if (amount.greaterThan(due)) {
      throw new UnprocessableEntityException({
        message: `Төлөнө турган бонус ${due.toFixed(2)} сом — андан ашык төлөнбөйт (§23.2)`,
        code: 'AMOUNT_OVER_PAYABLE',
        payable: due.toFixed(2),
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const document = await this.documents.create(tx, {
        docType: doc_type.BON,
        businessDate: resolveBusinessDate(dto.business_date),
        userId,
        comment: dto.comment ?? null,
      });

      await tx.bonus_payments.create({
        data: {
          document_id: document.id,
          employee_id: dto.employee_id,
          account_id: dto.account_id,
          amount,
        },
      });

      return document;
    });
  }

  /**
   * Paying it: money out, and the bonuses it covers marked PAID.
   *
   * Oldest first, so a part payment settles the sales that have waited
   * longest. A bonus only partly covered stays PAYABLE for the remainder —
   * §23 tracks a payable amount, not a queue of all-or-nothing rows.
   */
  async post(
    tx: Prisma.TransactionClient,
    document: documents,
    userId: string,
  ): Promise<void> {
    const payment = await tx.bonus_payments.findUnique({
      where: { document_id: document.id },
    });
    if (!payment) {
      throw new NotFoundException(
        `Bonus payment body missing for ${document.doc_number}`,
      );
    }

    const { account, balance } = await this.accounts.lockBalance(
      tx,
      payment.account_id,
    );
    await this.accounts.postMovement(tx, {
      accountId: payment.account_id,
      documentId: document.id,
      amount: payment.amount.negated(),
      kgsValue: null,
      currentBalance: balance,
      accountName: account.name,
    });

    const payable = await tx.bonuses.findMany({
      where: {
        employee_id: payment.employee_id,
        bstatus: { in: [bonus_status.PAYABLE, bonus_status.ADJUSTED] },
        payable_amount: { gt: 0 },
      },
      orderBy: { calculated_at: 'asc' },
    });

    let left = payment.amount;
    const covered: Prisma.InputJsonValue[] = [];

    for (const bonus of payable) {
      if (left.lessThanOrEqualTo(ZERO)) break;

      const take = Prisma.Decimal.min(bonus.payable_amount, left);
      const remaining = bonus.payable_amount.minus(take);

      await tx.bonuses.update({
        where: { id: bonus.id },
        data: {
          payable_amount: remaining,
          ...(remaining.lessThanOrEqualTo(ZERO)
            ? {
                bstatus: bonus_status.PAID,
                paid_at: new Date(),
                payment_doc: document.id,
              }
            : {}),
        },
      });

      covered.push({
        bonus_id: bonus.id,
        sale_id: bonus.sale_id,
        amount: take.toFixed(2),
        fully_paid: remaining.lessThanOrEqualTo(ZERO),
      });
      left = left.minus(take);
    }

    await this.audit.log(
      {
        userId,
        documentId: document.id,
        entity: 'bonus_payments',
        entityId: document.id,
        action: 'BONUS_PAID',
        newValue: {
          employee_id: payment.employee_id,
          amount: payment.amount.toFixed(2),
          account_id: payment.account_id,
          bonuses: covered,
        },
        reason: document.comment,
      },
      tx,
    );
  }

  // ── reading ───────────────────────────────────────────────────────────

  findMany(filter: {
    employeeId?: string;
    status?: bonus_status;
  }): Promise<bonuses[]> {
    return this.prisma.bonuses.findMany({
      where: {
        ...(filter.employeeId ? { employee_id: filter.employeeId } : {}),
        ...(filter.status ? { bstatus: filter.status } : {}),
      },
      orderBy: { calculated_at: 'desc' },
      take: 200,
    });
  }

  /** What each employee is owed right now (§23.2). */
  async standing(): Promise<
    {
      employee_id: string;
      full_name: string;
      bonus_rate_pct: string;
      calculated: string;
      payable: string;
    }[]
  > {
    const employees = await this.prisma.users.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, full_name: true, bonus_rate_pct: true },
      orderBy: { full_name: 'asc' },
    });

    const rows = await this.prisma.$queryRaw<
      { employee_id: string; calculated: Prisma.Decimal; payable: Prisma.Decimal }[]
    >`
      SELECT employee_id,
             SUM(CASE WHEN bstatus = 'CALCULATED' THEN payable_amount ELSE 0 END) AS calculated,
             SUM(CASE WHEN bstatus IN ('PAYABLE', 'ADJUSTED') THEN payable_amount ELSE 0 END) AS payable
      FROM bonuses
      GROUP BY employee_id
    `;
    const byEmployee = new Map(rows.map((row) => [row.employee_id, row]));

    return employees.map((employee) => {
      const row = byEmployee.get(employee.id);
      return {
        employee_id: employee.id,
        full_name: employee.full_name,
        bonus_rate_pct: employee.bonus_rate_pct.toFixed(2),
        calculated: (row?.calculated ?? ZERO).toFixed(2),
        payable: (row?.payable ?? ZERO).toFixed(2),
      };
    });
  }

  async payableTotal(db: Db, employeeId: string): Promise<Prisma.Decimal> {
    const [row] = await db.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT SUM(payable_amount) AS total
      FROM bonuses
      WHERE employee_id = ${employeeId}::uuid
        AND bstatus IN ('PAYABLE', 'ADJUSTED')
    `;
    return row?.total ?? ZERO;
  }

  /**
   * The rate this sale is paid at (§23).
   *
   * The seller's own rate when they have one, otherwise the OWNER's default.
   * With neither set the rate is zero and the bonus is zero — a sale is never
   * blocked by an unconfigured bonus rate, and the bonus list shows the zero
   * rate plainly.
   */
  private async rateFor(
    db: Db,
    employeeId: string,
  ): Promise<Prisma.Decimal> {
    const user = await db.users.findUniqueOrThrow({
      where: { id: employeeId },
      select: { bonus_rate_pct: true },
    });
    if (user.bonus_rate_pct.greaterThan(ZERO)) {
      return user.bonus_rate_pct;
    }
    const fallback = await this.settings
      .optionalDecimal(SettingKey.BONUS_DEFAULT_RATE_PCT)
      .catch(() => null);
    return fallback ?? ZERO;
  }
}
