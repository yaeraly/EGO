import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  daily_cash_handovers,
  day_status,
  user_role,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { BusinessDaysService } from '../business-days/business-days.service';
import { toDecimal } from '../common/decimal';
import { resolveBusinessDate } from '../documents/business-date';
import { PrismaService } from '../prisma/prisma.service';
import { TransfersService } from '../transfers/transfers.service';
import { CreateCashHandoverDto } from './dto/day-close.dto';

const ZERO = new Prisma.Decimal(0);

export interface AccountDayLine {
  account_id: string;
  name: string;
  type: string;
  /** What came in on this day, and what went out. */
  received: string;
  paid_out: string;
  /** The balance now, which is what there is to hand over. */
  balance: string;
}

/** A handover, with its money at two decimal places like every other view. */
export interface HandoverView {
  id: string;
  business_date: string;
  user_id: string;
  expected_amount: string;
  actual_amount: string;
  difference: string;
  difference_reason: string | null;
  transfer_doc_id: string | null;
  handed_at: string;
}

export function handoverView(row: daily_cash_handovers): HandoverView {
  return {
    id: row.id,
    business_date: row.business_date.toISOString().slice(0, 10),
    user_id: row.user_id,
    expected_amount: row.expected_amount.toFixed(2),
    actual_amount: row.actual_amount.toFixed(2),
    difference: row.difference.toFixed(2),
    difference_reason: row.difference_reason,
    transfer_doc_id: row.transfer_doc_id,
    handed_at: row.handed_at.toISOString(),
  };
}

/** A salesperson's own day, as §20 asks it to be shown. */
export interface DaySummary {
  business_date: string;
  user_id: string;
  full_name: string;
  day_status: day_status;
  sales_count: number;
  sales_total: string;
  credit_total: string;
  returns_total: string;
  advances_total: string;
  accounts: AccountDayLine[];
  /** The till the money is counted in: the seller's own KGS cash. */
  cash_expected: string;
  handover: HandoverView | null;
}

/**
 * The daily cash handover (§20).
 *
 * Each salesperson closes their own day: the system shows what it thinks they
 * took, they count the till, any difference is written down with its reason,
 * and the money goes to the account the OWNER named — by TRN, like every
 * other movement between accounts (§19, §42.3).
 *
 * The day itself becomes CASH_HANDED once nobody who worked it is still
 * holding money. Day Close is a separate step and the OWNER's (Period Lock).
 */
@Injectable()
export class CashHandoversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessDays: BusinessDaysService,
    private readonly transfers: TransfersService,
    private readonly audit: AuditService,
  ) {}

  /** What one person's day looks like (§20). */
  async summary(userId: string, businessDate: Date): Promise<DaySummary> {
    const user = await this.prisma.users.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, full_name: true },
    });

    const day = await this.prisma.business_days.findUnique({
      where: { business_date: businessDate },
    });

    const [sales] = await this.prisma.$queryRaw<
      {
        sales_count: bigint;
        sales_total: Prisma.Decimal | null;
        credit_total: Prisma.Decimal | null;
      }[]
    >`
      SELECT COUNT(*) AS sales_count,
             SUM(s.total_amount) AS sales_total,
             SUM(s.total_amount - s.paid_amount) AS credit_total
      FROM sales s
      JOIN documents d ON d.id = s.document_id
      WHERE s.salesperson = ${userId}::uuid
        AND d.business_date = ${businessDate}::date
        AND d.status = 'CONFIRMED'
    `;

    const [returns] = await this.prisma.$queryRaw<
      { total: Prisma.Decimal | null }[]
    >`
      SELECT SUM(r.total_return_amount) AS total
      FROM returns r
      JOIN documents d ON d.id = r.document_id
      WHERE d.business_date = ${businessDate}::date
        AND d.status = 'CONFIRMED'
        AND d.created_by = ${userId}::uuid
    `;

    const [advances] = await this.prisma.$queryRaw<
      { total: Prisma.Decimal | null }[]
    >`
      SELECT SUM(a.amount) AS total
      FROM advances a
      JOIN documents d ON d.id = a.document_id
      WHERE d.business_date = ${businessDate}::date
        AND d.status = 'CONFIRMED'
        AND d.created_by = ${userId}::uuid
    `;

    const accounts = await this.prisma.$queryRaw<
      {
        account_id: string;
        name: string;
        type: string;
        received: Prisma.Decimal | null;
        paid_out: Prisma.Decimal | null;
        balance: Prisma.Decimal | null;
      }[]
    >`
      SELECT a.id AS account_id, a.name, a.type::text AS type,
             COALESCE(today.received, 0) AS received,
             COALESCE(today.paid_out, 0) AS paid_out,
             COALESCE(all_time.balance, 0) AS balance
      FROM payment_accounts a
      LEFT JOIN LATERAL (
        SELECT SUM(m.amount) FILTER (WHERE m.amount > 0) AS received,
               -SUM(m.amount) FILTER (WHERE m.amount < 0) AS paid_out
        FROM account_movements m
        JOIN documents d ON d.id = m.document_id
        WHERE m.account_id = a.id AND d.business_date = ${businessDate}::date
      ) today ON true
      LEFT JOIN LATERAL (
        SELECT SUM(m.amount) AS balance
        FROM account_movements m
        WHERE m.account_id = a.id
      ) all_time ON true
      WHERE a.owner_user = ${userId}::uuid AND a.is_active
      ORDER BY a.type, a.name
    `;

    const cashExpected = accounts
      .filter((account) => account.type === 'CASH')
      .reduce((sum, account) => sum.plus(account.balance ?? ZERO), ZERO);

    const handover = await this.prisma.daily_cash_handovers.findUnique({
      where: {
        business_date_user_id: { business_date: businessDate, user_id: userId },
      },
    });

    return {
      business_date: businessDate.toISOString().slice(0, 10),
      user_id: user.id,
      full_name: user.full_name,
      day_status: day?.status ?? day_status.OPEN,
      sales_count: Number(sales.sales_count),
      sales_total: (sales.sales_total ?? ZERO).toFixed(2),
      credit_total: (sales.credit_total ?? ZERO).toFixed(2),
      returns_total: (returns?.total ?? ZERO).toFixed(2),
      advances_total: (advances?.total ?? ZERO).toFixed(2),
      accounts: accounts.map((account) => ({
        account_id: account.account_id,
        name: account.name,
        type: account.type,
        received: (account.received ?? ZERO).toFixed(2),
        paid_out: (account.paid_out ?? ZERO).toFixed(2),
        balance: (account.balance ?? ZERO).toFixed(2),
      })),
      cash_expected: cashExpected.toFixed(2),
      handover: handover ? handoverView(handover) : null,
    };
  }

  /**
   * Hands the till over (§20).
   *
   * The comparison, the difference and its reason, and the transfer all
   * commit together: a handover recorded without the money having moved would
   * be worse than none at all.
   */
  async create(
    dto: CreateCashHandoverDto,
    userId: string,
  ): Promise<HandoverView> {
    const businessDate = resolveBusinessDate(dto.business_date);

    const from = await this.prisma.payment_accounts.findUnique({
      where: { id: dto.from_account },
    });
    if (!from) {
      throw new NotFoundException('from_account табылган жок');
    }
    if (from.owner_user !== userId) {
      throw new BadRequestException(
        'Касса ээси өз эсебин гана өткөрөт (§19)',
      );
    }
    if (from.type !== 'CASH') {
      throw new BadRequestException(
        'Күндүк касса накталай эсептен өткөрүлөт (§20)',
      );
    }

    const to = await this.prisma.payment_accounts.findUnique({
      where: { id: dto.to_account },
    });
    if (!to || to.owner_user) {
      throw new BadRequestException(
        'Акча OWNER көрсөткөн борбордук эсепке өткөрүлөт (§19)',
      );
    }

    const existing = await this.prisma.daily_cash_handovers.findUnique({
      where: {
        business_date_user_id: { business_date: businessDate, user_id: userId },
      },
    });
    if (existing) {
      throw new ConflictException(
        'Бул күнгө касса мурда өткөрүлгөн — кайра өткөрүлбөйт (§20)',
      );
    }

    const summary = await this.summary(userId, businessDate);
    const expected = new Prisma.Decimal(summary.cash_expected);
    const actual = toDecimal(dto.actual_amount, 'actual_amount');
    if (actual.isNegative()) {
      throw new BadRequestException('actual_amount терс болбойт');
    }
    const difference = actual.minus(expected);

    if (!difference.isZero() && !dto.difference_reason?.trim()) {
      throw new BadRequestException({
        message: `Система ${expected.toFixed(2)} дейт, саналганы ${actual.toFixed(2)} — айырманын себеби жазылышы керек (§20)`,
        code: 'DIFFERENCE_REASON_REQUIRED',
      });
    }

    const handed = dto.handed_amount
      ? toDecimal(dto.handed_amount, 'handed_amount')
      : actual;
    if (handed.isNegative()) {
      throw new BadRequestException('handed_amount терс болбойт');
    }
    if (handed.greaterThan(actual)) {
      throw new BadRequestException(
        'Саналгандан ашык акча өткөрүлбөйт (§20)',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // A closed day accepts no TRN — §20 says the handover happens before
      // the close, never after it.
      await this.businessDays.ensureOpen(tx, businessDate);

      let transferId: string | null = null;
      if (handed.greaterThan(ZERO)) {
        const transfer = await this.transfers.createConfirmedWithin(tx, {
          fromAccount: from.id,
          toAccount: to.id,
          amount: handed,
          businessDate,
          userId,
          comment: `Күндүк касса өткөрүү (§20) — ${businessDate
            .toISOString()
            .slice(0, 10)}`,
        });
        transferId = transfer.id;
      }

      const handover = await tx.daily_cash_handovers.create({
        data: {
          business_date: businessDate,
          user_id: userId,
          expected_amount: expected,
          actual_amount: actual,
          difference,
          difference_reason: dto.difference_reason?.trim() || null,
          transfer_doc_id: transferId,
        },
      });

      await this.audit.log(
        {
          userId,
          documentId: transferId,
          entity: 'daily_cash_handovers',
          entityId: handover.id,
          action: 'CASH_HANDED_OVER',
          newValue: {
            business_date: businessDate.toISOString().slice(0, 10),
            expected: expected.toFixed(2),
            actual: actual.toFixed(2),
            difference: difference.toFixed(2),
            handed: handed.toFixed(2),
            to_account: to.name,
          },
          reason: dto.difference_reason?.trim() ?? null,
        },
        tx,
      );

      // The day moves on once nobody who worked it is still holding money.
      await this.markCashHandedIfComplete(tx, businessDate);

      return handoverView(handover);
    });
  }

  /**
   * Who worked this day and has not handed over yet (Day Close Pre-check).
   *
   * "Worked" means raised at least one confirmed document with that business
   * date — the people whose day there is something to close. A seller who
   * took no cash still hands over: the comparison is the record, and it is
   * zero against zero.
   */
  async pendingHandovers(
    db: Prisma.TransactionClient | PrismaService,
    businessDate: Date,
  ): Promise<{ user_id: string; full_name: string }[]> {
    return db.$queryRaw<{ user_id: string; full_name: string }[]>`
      SELECT u.id AS user_id, u.full_name
      FROM users u
      WHERE u.role != ${user_role.OWNER}::user_role
        AND EXISTS (
          SELECT 1 FROM documents d
          WHERE d.created_by = u.id
            AND d.business_date = ${businessDate}::date
            AND d.status = 'CONFIRMED'
        )
        AND NOT EXISTS (
          SELECT 1 FROM daily_cash_handovers h
          WHERE h.user_id = u.id AND h.business_date = ${businessDate}::date
        )
      ORDER BY u.full_name
    `;
  }

  private async markCashHandedIfComplete(
    tx: Prisma.TransactionClient,
    businessDate: Date,
  ): Promise<void> {
    const pending = await this.pendingHandovers(tx, businessDate);
    if (pending.length > 0) {
      return;
    }
    await tx.business_days.update({
      where: { business_date: businessDate },
      data: { status: day_status.CASH_HANDED },
    });
  }

  async findMany(businessDate: Date): Promise<HandoverView[]> {
    const rows = await this.prisma.daily_cash_handovers.findMany({
      where: { business_date: businessDate },
      orderBy: { handed_at: 'asc' },
    });
    return rows.map(handoverView);
  }
}
