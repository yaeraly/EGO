import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Period } from './reports.repository';

/**
 * A document a confirmed correction reversed never happened, for the same
 * reason the Profit and Loss leaves it out (§27.1).
 */
const NOT_REVERSED = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM corrections co
  JOIN documents cd ON cd.id = co.document_id
  WHERE co.original_document_id = d.id AND cd.status = 'CONFIRMED'
)`;

export interface SellerRow {
  user_id: string;
  full_name: string;
  sales: bigint;
  revenue: Prisma.Decimal;
  cogs: Prisma.Decimal;
  credit_revenue: Prisma.Decimal;
  credit_sales: bigint;
  new_customers: bigint;
}

export interface CustomerRow {
  customer_id: string;
  name: string;
  ctype: string;
  category: string;
  purchases: bigint;
  revenue: Prisma.Decimal;
  cogs: Prisma.Decimal;
  first_purchase: Date | null;
  last_purchase: Date | null;
}

@Injectable()
export class PerformanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What each salesperson sold over a period (§31).
   *
   * A new customer is one whose first ever purchase falls in this period and
   * was made with this salesperson — §24 counts new customers as something a
   * seller brought in, not merely served. The Walk-in customer is never new:
   * it is one row standing for everyone unregistered (§11.1).
   */
  sellers(period: Period): Promise<SellerRow[]> {
    return this.prisma.$queryRaw`
      SELECT u.id AS user_id, u.full_name,
             COUNT(s.document_id) AS sales,
             COALESCE(SUM(s.total_amount), 0) AS revenue,
             COALESCE(SUM(s.total_cogs), 0) AS cogs,
             COALESCE(SUM(s.total_amount - s.paid_amount), 0) AS credit_revenue,
             COUNT(*) FILTER (WHERE s.total_amount > s.paid_amount) AS credit_sales,
             COALESCE(new_ones.count, 0) AS new_customers
      FROM users u
      LEFT JOIN sales s ON s.salesperson = u.id
      LEFT JOIN documents d ON d.id = s.document_id
        AND d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
        AND ${NOT_REVERSED}
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS count FROM (
          SELECT c.id
          FROM customers c
          JOIN sales fs ON fs.customer_id = c.id
          JOIN documents fd ON fd.id = fs.document_id
          WHERE NOT c.is_walk_in AND fd.status = 'CONFIRMED'
          GROUP BY c.id
          HAVING MIN(fd.business_date)
                   BETWEEN ${period.from}::date AND ${period.to}::date
             AND (ARRAY_AGG(fs.salesperson ORDER BY fd.business_date, fd.created_at))[1] = u.id
        ) first_timers
      ) new_ones ON true
      WHERE u.status = 'ACTIVE'
      GROUP BY u.id, u.full_name, new_ones.count
      HAVING COUNT(d.id) > 0 OR COALESCE(new_ones.count, 0) > 0
      ORDER BY revenue DESC
    `;
  }

  /** A salesperson's own tills and bank accounts, right now (§19, §31). */
  sellerAccounts(): Promise<
    { user_id: string; name: string; currency: string; balance: Prisma.Decimal }[]
  > {
    return this.prisma.$queryRaw`
      SELECT a.owner_user AS user_id, a.name, a.currency::text AS currency,
             COALESCE(SUM(m.amount), 0) AS balance
      FROM payment_accounts a
      LEFT JOIN account_movements m ON m.account_id = a.id
      WHERE a.owner_user IS NOT NULL AND a.is_active
      GROUP BY a.owner_user, a.name, a.currency
      ORDER BY a.name
    `;
  }

  /** Bonus standing per salesperson, by status (§23, §31). */
  sellerBonuses(): Promise<
    { employee_id: string; bstatus: string; amount: Prisma.Decimal }[]
  > {
    return this.prisma.$queryRaw`
      SELECT employee_id, bstatus::text AS bstatus, SUM(payable_amount) AS amount
      FROM bonuses
      GROUP BY employee_id, bstatus
    `;
  }

  /** What each registered customer bought over a period (§30). */
  customers(period: Period): Promise<CustomerRow[]> {
    return this.prisma.$queryRaw`
      SELECT c.id AS customer_id, c.name,
             c.ctype::text AS ctype, c.category::text AS category,
             COUNT(*) AS purchases,
             SUM(s.total_amount) AS revenue,
             SUM(s.total_cogs) AS cogs,
             MIN(d.business_date) AS first_purchase,
             MAX(d.business_date) AS last_purchase
      FROM sales s
      JOIN documents d ON d.id = s.document_id
      JOIN customers c ON c.id = s.customer_id
      WHERE d.status = 'CONFIRMED'
        AND NOT c.is_walk_in
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
        AND ${NOT_REVERSED}
      GROUP BY c.id, c.name, c.ctype, c.category
      ORDER BY revenue DESC
    `;
  }

  /** What each customer still owes, whenever it was sold (§16). */
  customerDebts(): Promise<{ customer_id: string; debt: Prisma.Decimal }[]> {
    return this.prisma.$queryRaw`
      SELECT s.customer_id, SUM(s.outstanding_amount) AS debt
      FROM sales s
      JOIN documents d ON d.id = s.document_id
      WHERE d.status = 'CONFIRMED' AND s.outstanding_amount > 0
      GROUP BY s.customer_id
    `;
  }

  /** How each customer's reservations ended (§17, §30). */
  customerReservations(): Promise<
    { customer_id: string; rstatus: string; count: bigint }[]
  > {
    return this.prisma.$queryRaw`
      SELECT r.customer_id, r.rstatus::text AS rstatus, COUNT(*) AS count
      FROM reservations r
      JOIN documents d ON d.id = r.document_id
      WHERE d.status = 'CONFIRMED'
      GROUP BY r.customer_id, r.rstatus
    `;
  }

  /**
   * Customers who used to buy and have not since a date (§30).
   *
   * "Мурда активдүү" is read as: they have bought at least twice, so there
   * was a habit to lose. Someone who bought once and never returned was never
   * a regular, and listing them would bury the ones worth a phone call.
   */
  lapsedCustomers(since: Date): Promise<
    {
      customer_id: string;
      name: string;
      phone: string | null;
      purchases: bigint;
      revenue: Prisma.Decimal;
      last_purchase: Date;
    }[]
  > {
    return this.prisma.$queryRaw`
      SELECT c.id AS customer_id, c.name, c.phone,
             COUNT(*) AS purchases,
             SUM(s.total_amount) AS revenue,
             MAX(d.business_date) AS last_purchase
      FROM sales s
      JOIN documents d ON d.id = s.document_id
      JOIN customers c ON c.id = s.customer_id
      WHERE d.status = 'CONFIRMED' AND NOT c.is_walk_in
      GROUP BY c.id, c.name, c.phone
      HAVING MAX(d.business_date) < ${since}::date AND COUNT(*) > 1
      ORDER BY revenue DESC
    `;
  }
}
