import { Injectable } from '@nestjs/common';
import { Prisma, business_days, month_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BusinessDaysRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Opens the day if it is new, then takes it FOR SHARE.
   *
   * Share locks do not conflict with each other, so concurrent document
   * creation is unaffected; a Day Close taking the row FOR UPDATE has to wait
   * for in-flight documents to commit and cannot seal a day underneath one
   * (§20, Period Lock).
   */
  async openAndShareLock(
    tx: Prisma.TransactionClient,
    businessDate: Date,
  ): Promise<business_days> {
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
    return day;
  }

  findMonthStatus(
    tx: Prisma.TransactionClient,
    year: number,
    month: number,
  ): Promise<{ status: month_status } | null> {
    return tx.business_months.findUnique({
      where: { year_month: { year, month } },
      select: { status: true },
    });
  }

  findByDate(businessDate: Date): Promise<business_days | null> {
    return this.prisma.business_days.findUnique({
      where: { business_date: businessDate },
    });
  }

  findRecent(take = 200): Promise<business_days[]> {
    return this.prisma.business_days.findMany({
      orderBy: { business_date: 'desc' },
      take,
    });
  }
}
