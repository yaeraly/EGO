import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PurchaseAdviceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * How long deliveries actually take, in days (§6, §33).
   *
   * Measured, not configured. From the day the order was placed to the day
   * its goods were received — the receipt, not a logistics status: §6's
   * sixteen stages are moved by hand and one nobody remembered to click
   * would silently lengthen every future suggestion. A confirmed receipt is
   * the day the goods were really there (§7).
   *
   * The median rather than the average: one batch stuck in customs for three
   * months should not decide what to order today.
   *
   * Per supplier, and overall as a fallback for a supplier nobody has ordered
   * from yet.
   */
  leadTimes(): Promise<
    { supplier_id: string | null; days: number; batches: bigint }[]
  > {
    return this.prisma.$queryRaw`
      WITH deliveries AS (
        SELECT p.supplier_id,
               (MIN(rd.business_date) - od.business_date) AS days
        FROM purchases p
        JOIN documents od ON od.id = p.document_id
        JOIN receipts r ON r.purchase_id = p.document_id
        JOIN documents rd ON rd.id = r.document_id
        WHERE od.status = 'CONFIRMED' AND rd.status = 'CONFIRMED'
        GROUP BY p.document_id, p.supplier_id, od.business_date
      )
      SELECT supplier_id,
             CEIL(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days))::int AS days,
             COUNT(*) AS batches
      FROM deliveries
      WHERE days >= 0
      GROUP BY GROUPING SETS ((supplier_id), ())
      HAVING COUNT(*) > 0
    `;
  }

  /**
   * What each product sold per day, over a window (§33 — "сатуу ылдамдыгы").
   *
   * Net of returns (§35.7), and counting only the days the window really
   * covers, so a product first stocked last week is not judged as though it
   * had a whole quarter to sell in.
   */
  salesVelocity(
    since: Date,
    until: Date,
  ): Promise<
    {
      product_id: string;
      qty: Prisma.Decimal;
      first_sold: Date;
      last_sold: Date;
      sales: bigint;
    }[]
  > {
    return this.prisma.$queryRaw`
      SELECT si.product_id,
             SUM(si.qty - si.returned_qty) AS qty,
             MIN(d.business_date) AS first_sold,
             MAX(d.business_date) AS last_sold,
             COUNT(DISTINCT s.document_id) AS sales
      FROM sale_items si
      JOIN sales s ON s.document_id = si.sale_id
      JOIN documents d ON d.id = s.document_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${since}::date AND ${until}::date
        AND NOT EXISTS (
          SELECT 1 FROM corrections co
          JOIN documents cd ON cd.id = co.document_id
          WHERE co.original_document_id = d.id AND cd.status = 'CONFIRMED'
        )
      GROUP BY si.product_id
      HAVING SUM(si.qty - si.returned_qty) > 0
    `;
  }

  /**
   * The last price paid for each product, in yuan, and who to order it from
   * (§12-Б.5).
   *
   * The price of the last order, and failing that the price entered on the
   * product card when it was created (§12-Б.5) — a part nobody has ordered
   * yet can still be priced. The supplier likewise: the last order's, and
   * failing that the card's main supplier.
   */
  lastPrices(): Promise<
    {
      product_id: string;
      price_cny: Prisma.Decimal | null;
      supplier_id: string | null;
    }[]
  > {
    return this.prisma.$queryRaw`
      SELECT p.id AS product_id,
             COALESCE(last.price_cny, p.purchase_price_cny) AS price_cny,
             COALESCE(last.supplier_id, p.main_supplier_id) AS supplier_id
      FROM products p
      LEFT JOIN LATERAL (
        SELECT i.price_cny, pu.supplier_id
        FROM purchase_items i
        JOIN purchases pu ON pu.document_id = i.purchase_id
        JOIN documents d ON d.id = pu.document_id
        WHERE i.product_id = p.id AND d.status = 'CONFIRMED'
        ORDER BY d.business_date DESC, d.created_at DESC
        LIMIT 1
      ) last ON true
      WHERE p.is_active
    `;
  }

  /** What the yuan till holds, which is what an order can be paid from. */
  async availableCny(): Promise<Prisma.Decimal> {
    const [row] = await this.prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT COALESCE(SUM(m.amount), 0) AS total
      FROM account_movements m
      JOIN payment_accounts a ON a.id = m.account_id
      WHERE a.currency = 'CNY' AND a.is_active
    `;
    return row?.total ?? new Prisma.Decimal(0);
  }
}
