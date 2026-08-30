import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, business_days, day_status, month_status } from '@prisma/client';
import { LockedException } from '../common/locked.exception';
import { PrismaService } from '../prisma/prisma.service';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Business days and the Period Lock (§20, Period Lock).
 *
 * This is the skeleton the specification asks for: days appear on first use
 * and closed periods refuse new documents. Closing a day — the cash handover
 * pre-checks, the CASH_HANDED step, the reports — is Priority 2.
 */
@Injectable()
export class BusinessDaysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensures the day exists and accepts documents.
   *
   * The row is created on first use, so a day never has to be opened by hand.
   * It is then taken FOR SHARE: share locks do not conflict with each other,
   * so concurrent document creation is unaffected, but a Day Close taking the
   * row FOR UPDATE has to wait for in-flight documents to commit — it cannot
   * seal a day underneath a document being written to it.
   */
  async ensureOpen(
    tx: Prisma.TransactionClient,
    businessDate: Date,
  ): Promise<business_days> {
    await this.assertMonthOpen(tx, businessDate);

    // A concurrent creator may win the insert; this one falls through to the
    // lock either way.
    await tx.$executeRaw`
      INSERT INTO business_days (business_date, status)
      VALUES (${businessDate}::date, 'OPEN'::day_status)
      ON CONFLICT (business_date) DO NOTHING
    `;

    const [day] = await tx.$queryRaw<business_days[]>`
      SELECT * FROM business_days
      WHERE business_date = ${businessDate}::date
      FOR SHARE
    `;

    if (day.status === day_status.DAY_CLOSED) {
      throw new LockedException(
        `Business day ${isoDate(businessDate)} is closed; a change to it needs a correction document (COR)`,
      );
    }

    // CASH_HANDED deliberately still accepts documents: the cash is counted
    // but the day is not sealed. What that step should restrict belongs to
    // Day Close, in Priority 2.
    return day;
  }

  /**
   * A closed month seals every day in it.
   *
   * The specification scopes 0.6 to business_days; this check is included
   * because a closed month with days still accepting documents would leave a
   * hole in the same Period Lock the day check exists to enforce.
   */
  private async assertMonthOpen(
    tx: Prisma.TransactionClient,
    businessDate: Date,
  ): Promise<void> {
    const year = businessDate.getUTCFullYear();
    const month = businessDate.getUTCMonth() + 1;

    const period = await tx.business_months.findUnique({
      where: { year_month: { year, month } },
      select: { status: true },
    });

    if (period?.status === month_status.MONTH_CLOSED) {
      throw new LockedException(
        `Period ${year}-${String(month).padStart(2, '0')} is closed; a change to it needs a correction document (COR)`,
      );
    }
  }

  async findOne(businessDate: Date): Promise<business_days> {
    const day = await this.prisma.business_days.findUnique({
      where: { business_date: businessDate },
    });
    if (!day) {
      throw new NotFoundException(
        `Business day ${isoDate(businessDate)} has not been used yet`,
      );
    }
    return day;
  }

  findMany(): Promise<business_days[]> {
    return this.prisma.business_days.findMany({
      orderBy: { business_date: 'desc' },
      take: 200,
    });
  }
}
