import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  business_days,
  business_months,
  day_status,
  month_status,
  user_role,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { BusinessDaysService } from '../business-days/business-days.service';
import { DayCloseBlocker } from '../business-days/day-close-blockers';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { CashHandoversService } from './cash-handovers.service';

export interface DayClosePreCheck {
  business_date: string;
  status: day_status;
  /** Period Lock: Unresolved Documents = 0. */
  unresolved: DayCloseBlocker[];
  /** Period Lock: every salesperson who worked has handed their till over. */
  pending_handovers: { user_id: string; full_name: string }[];
  can_close: boolean;
}

export interface MonthClosePreCheck {
  year: number;
  month: number;
  status: month_status;
  /** Days of the month still not closed — the month waits for every one. */
  open_days: { business_date: string; status: day_status }[];
  can_close: boolean;
}

/**
 * Day Close and Month Close (§20, Period Lock).
 *
 * The pre-check is not advice. Period Lock is explicit that an unresolved
 * document blocks the close and that "OWNER да кадимки Day Close аркылуу
 * текшерүүнү bypass кыла албайт" — so there is no force flag here, and the
 * refusal names the documents rather than a count.
 */
@Injectable()
export class DayCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessDays: BusinessDaysService,
    private readonly handovers: CashHandoversService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  /** What stands between this day and a close (Day Close Pre-check). */
  async preCheck(businessDate: Date): Promise<DayClosePreCheck> {
    const day = await this.prisma.business_days.findUnique({
      where: { business_date: businessDate },
    });
    const [unresolved, pending] = await Promise.all([
      this.businessDays.dayCloseBlockers(businessDate),
      this.handovers.pendingHandovers(this.prisma, businessDate),
    ]);

    return {
      business_date: businessDate.toISOString().slice(0, 10),
      status: day?.status ?? day_status.OPEN,
      unresolved,
      pending_handovers: pending,
      can_close:
        day?.status !== day_status.DAY_CLOSED &&
        unresolved.length === 0 &&
        pending.length === 0,
    };
  }

  /** OPEN/CASH_HANDED -> DAY_CLOSED. The OWNER's, and always with a PIN. */
  async closeDay(
    businessDate: Date,
    pin: string,
    user: { id: string; role: user_role },
    ip?: string,
  ): Promise<business_days> {
    this.assertOwner(user, 'Күндү ээси гана жабат (§20)');
    await this.assertPin(user.id, pin, `day-close:${businessDate.toISOString().slice(0, 10)}`, ip);

    return this.prisma.$transaction(async (tx) => {
      // FOR UPDATE, so a document being written to this day has to commit
      // before the day can be sealed — and cannot start afterwards.
      const [day] = await tx.$queryRaw<business_days[]>`
        SELECT * FROM business_days
        WHERE business_date = ${businessDate}::date
        FOR UPDATE
      `;
      if (!day) {
        throw new ConflictException(
          `${businessDate.toISOString().slice(0, 10)} — бул күнү эч кандай операция болгон эмес`,
        );
      }
      if (day.status === day_status.DAY_CLOSED) {
        throw new ConflictException(
          `${businessDate.toISOString().slice(0, 10)} мурда жабылган`,
        );
      }

      const [unresolved, pending] = await Promise.all([
        this.businessDays.dayCloseBlockers(businessDate),
        this.handovers.pendingHandovers(tx, businessDate),
      ]);

      if (unresolved.length > 0 || pending.length > 0) {
        // Named, not counted: Period Lock says the person closing the day is
        // shown the concrete list.
        throw new UnprocessableEntityException({
          message:
            'Күн жабылбайт: бүтпөгөн документтер же өткөрүлбөгөн касса бар (Period Lock)',
          code: 'DAY_CLOSE_BLOCKED',
          unresolved,
          pending_handovers: pending,
        });
      }

      const closed = await tx.business_days.update({
        where: { business_date: businessDate },
        data: {
          status: day_status.DAY_CLOSED,
          closed_by: user.id,
          closed_at: new Date(),
        },
      });

      await this.audit.log(
        {
          userId: user.id,
          entity: 'business_days',
          entityId: businessDate.toISOString().slice(0, 10),
          action: 'DAY_CLOSED',
          oldValue: { status: day.status },
          newValue: { status: day_status.DAY_CLOSED },
        },
        tx,
      );

      return closed;
    });
  }

  /** Every day of the month that was used must be closed first. */
  async monthPreCheck(year: number, month: number): Promise<MonthClosePreCheck> {
    const period = await this.prisma.business_months.findUnique({
      where: { year_month: { year, month } },
    });

    const openDays = await this.prisma.$queryRaw<
      { business_date: Date; status: day_status }[]
    >`
      SELECT business_date, status
      FROM business_days
      WHERE EXTRACT(YEAR FROM business_date) = ${year}
        AND EXTRACT(MONTH FROM business_date) = ${month}
        AND status != 'DAY_CLOSED'
      ORDER BY business_date
    `;

    return {
      year,
      month,
      status: period?.status ?? month_status.OPEN,
      open_days: openDays.map((day) => ({
        business_date: day.business_date.toISOString().slice(0, 10),
        status: day.status,
      })),
      can_close:
        period?.status !== month_status.MONTH_CLOSED && openDays.length === 0,
    };
  }

  async closeMonth(
    year: number,
    month: number,
    pin: string,
    user: { id: string; role: user_role },
    ip?: string,
  ): Promise<business_months> {
    this.assertOwner(user, 'Айды ээси гана жабат (Period Lock)');
    await this.assertPin(user.id, pin, `month-close:${year}-${month}`, ip);

    return this.prisma.$transaction(async (tx) => {
      const check = await this.monthPreCheck(year, month);
      if (check.status === month_status.MONTH_CLOSED) {
        throw new ConflictException(
          `${year}-${String(month).padStart(2, '0')} мурда жабылган`,
        );
      }
      if (check.open_days.length > 0) {
        throw new UnprocessableEntityException({
          message:
            'Ай жабылбайт: айдын ичинде жабылбаган күндөр бар (Period Lock)',
          code: 'MONTH_CLOSE_BLOCKED',
          open_days: check.open_days,
        });
      }

      const period = await tx.business_months.upsert({
        where: { year_month: { year, month } },
        create: {
          year,
          month,
          status: month_status.MONTH_CLOSED,
          closed_by: user.id,
          closed_at: new Date(),
        },
        update: {
          status: month_status.MONTH_CLOSED,
          closed_by: user.id,
          closed_at: new Date(),
          reopen_reason: null,
        },
      });

      await this.audit.log(
        {
          userId: user.id,
          entity: 'business_months',
          entityId: `${year}-${String(month).padStart(2, '0')}`,
          action: 'MONTH_CLOSED',
          newValue: { status: month_status.MONTH_CLOSED },
        },
        tx,
      );

      return period;
    });
  }

  /**
   * Period Reopen.
   *
   * "Жабылган айды кайра OPEN кылуу күнүмдүк оңдоо ыкмасы эмес" — the ordinary
   * fix for a closed period is a correction document (§27.1). Reopening is for
   * the exceptional case, and it is never silent: the OWNER, a reason, and an
   * audit entry that keeps who and when.
   */
  async reopenMonth(
    year: number,
    month: number,
    reason: string,
    pin: string,
    user: { id: string; role: user_role },
    ip?: string,
  ): Promise<business_months> {
    this.assertOwner(user, 'Айды ээси гана кайра ачат (Period Reopen)');
    await this.assertPin(user.id, pin, `month-reopen:${year}-${month}`, ip);

    return this.prisma.$transaction(async (tx) => {
      const period = await tx.business_months.findUnique({
        where: { year_month: { year, month } },
      });
      if (!period || period.status !== month_status.MONTH_CLOSED) {
        throw new ConflictException(
          `${year}-${String(month).padStart(2, '0')} жабылган эмес`,
        );
      }

      const reopened = await tx.business_months.update({
        where: { year_month: { year, month } },
        data: {
          status: month_status.OPEN,
          reopen_reason: reason,
          closed_by: null,
          closed_at: null,
        },
      });

      await this.audit.log(
        {
          userId: user.id,
          entity: 'business_months',
          entityId: `${year}-${String(month).padStart(2, '0')}`,
          action: 'MONTH_REOPENED',
          oldValue: {
            status: month_status.MONTH_CLOSED,
            closed_by: period.closed_by,
            closed_at: period.closed_at?.toISOString() ?? null,
          },
          newValue: { status: month_status.OPEN },
          reason,
        },
        tx,
      );

      return reopened;
    });
  }

  private assertOwner(user: { role: user_role }, message: string): void {
    if (user.role !== user_role.OWNER) {
      throw new UnprocessableEntityException({ message, code: 'OWNER_ONLY' });
    }
  }

  private async assertPin(
    userId: string,
    pin: string,
    device: string,
    ip?: string,
  ): Promise<void> {
    const { valid } = await this.auth.verifyPin(userId, pin, {
      ip: ip ?? null,
      device,
    });
    if (!valid) {
      throw new UnprocessableEntityException({
        message: 'PIN туура эмес',
        code: 'PIN_INVALID',
      });
    }
  }
}
