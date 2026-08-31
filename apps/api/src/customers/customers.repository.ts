import { Injectable } from '@nestjs/common';
import { Prisma, customers } from '@prisma/client';
import { Db } from '../common/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(data: Prisma.customersCreateInput): Promise<customers> {
    return this.prisma.customers.create({ data });
  }

  findById(id: string, db: Db = this.prisma): Promise<customers | null> {
    return db.customers.findUnique({ where: { id } });
  }

  findWalkIn(db: Db = this.prisma): Promise<customers | null> {
    return db.customers.findFirst({ where: { is_walk_in: true } });
  }

  update(id: string, data: Prisma.customersUpdateInput): Promise<customers> {
    return this.prisma.customers.update({ where: { id }, data });
  }

  /**
   * Name-or-phone search for the autocomplete on the sale screen (§14).
   *
   * Phone is indexed and name is matched case-insensitively; the limit keeps
   * the round trip short enough to type against.
   */
  findMany(filter: {
    query?: string;
    includeInactive?: boolean;
    limit?: number;
  }): Promise<customers[]> {
    const query = filter.query?.trim();
    return this.prisma.customers.findMany({
      where: {
        ...(filter.includeInactive ? {} : { is_active: true }),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { phone: { contains: query } },
              ],
            }
          : {}),
      },
      orderBy: [{ is_walk_in: 'desc' }, { name: 'asc' }],
      take: Math.min(filter.limit ?? 20, 100),
    });
  }

  /**
   * Turnover over a rolling window (§12.1).
   *
   * Confirmed sales less what was returned, taken from the sale lines rather
   * than the header so a partial return counts for exactly what came back.
   * `final_price` is the price of one unit, so the line's revenue is the
   * quantity still sold times that price. Advances and reservations are not
   * sales and do not appear here.
   */
  async turnoverSince(
    db: Db,
    customerId: string,
    since: Date,
  ): Promise<Prisma.Decimal> {
    const [row] = await db.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT COALESCE(SUM((i.qty - i.returned_qty) * i.final_price), 0) AS total
      FROM sale_items i
      JOIN sales s ON s.document_id = i.sale_id
      JOIN documents d ON d.id = s.document_id
      WHERE s.customer_id = ${customerId}::uuid
        AND d.status = 'CONFIRMED'
        AND d.business_date >= ${since}
    `;
    return row.total ?? new Prisma.Decimal(0);
  }

  /** How many customers the OWNER has categorised by hand (§12.1). */
  countManualOverrides(): Promise<number> {
    return this.prisma.customers.count({
      where: { is_walk_in: false, is_active: true, category_manual_override: true },
    });
  }

  /** Registered customers the monthly job walks (§12.1). Walk-in excluded. */
  forCategoryRecalculation(): Promise<customers[]> {
    return this.prisma.customers.findMany({
      where: {
        is_walk_in: false,
        is_active: true,
        category_manual_override: false,
      },
      orderBy: { created_at: 'asc' },
    });
  }
}
