import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, business_days, day_status, month_status } from '@prisma/client';
import { LockedException } from '../common/locked.exception';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessDaysRepository } from './business-days.repository';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: BusinessDaysRepository,
  ) {}

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
    const day = await this.repository.openAndShareLock(tx, businessDate);

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

    const period = await this.repository.findMonthStatus(tx, year, month);

    if (period?.status === month_status.MONTH_CLOSED) {
      throw new LockedException(
        `Period ${year}-${String(month).padStart(2, '0')} is closed; a change to it needs a correction document (COR)`,
      );
    }
  }

  async findOne(businessDate: Date): Promise<business_days> {
    const day = await this.repository.findByDate(businessDate);
    if (!day) {
      throw new NotFoundException(
        `Business day ${isoDate(businessDate)} has not been used yet`,
      );
    }
    return day;
  }

  findMany(): Promise<business_days[]> {
    return this.repository.findRecent();
  }
}
