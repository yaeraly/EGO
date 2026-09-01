import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Period } from './reports.repository';

export interface ProductSalesRow {
  product_id: string;
  sku: string;
  name: string;
  category: string | null;
  qty: Prisma.Decimal;
  revenue: Prisma.Decimal;
  cogs: Prisma.Decimal;
  sales: bigint;
  last_sold: Date | null;
}

export interface ProductPeriodRow {
  product_id: string;
  bucket: Date;
  qty: Prisma.Decimal;
}

export interface SalesTrendRow {
  bucket: Date;
  sales: bigint;
  revenue: Prisma.Decimal;
  cogs: Prisma.Decimal;
}

export interface ReorderRow {
  product_id: string;
  sku: string;
  name: string;
  min_stock: Prisma.Decimal;
  reorder_point: Prisma.Decimal;
  on_hand: Prisma.Decimal;
  reserved: Prisma.Decimal;
  inbound: Prisma.Decimal;
  sold_recently: Prisma.Decimal;
}

/**
 * The analytical reports (§29).
 *
 * A sale that came back is not a sale: every figure here is net of returns,
 * counted through `sale_items.returned_qty` (§35.7), so a product returned in
 * full does not sit at the top of the ABC list.
 *
 * A document a confirmed correction reversed is left out, for the same reason
 * the Profit and Loss leaves it out (§27.1).
 */
@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** What each product sold, what it cost and what it earned, over a period. */
  productSales(period: Period): Promise<ProductSalesRow[]> {
    return this.prisma.$queryRaw`
      SELECT p.id AS product_id, p.sku, p.name,
             c.name AS category,
             SUM(si.qty - si.returned_qty) AS qty,
             SUM((si.qty - si.returned_qty) * si.final_price) AS revenue,
             SUM(
               CASE WHEN si.qty > 0
                 THEN si.fifo_cogs * (si.qty - si.returned_qty) / si.qty
                 ELSE 0 END
             ) AS cogs,
             COUNT(DISTINCT s.document_id) AS sales,
             MAX(d.business_date) AS last_sold
      FROM sale_items si
      JOIN sales s ON s.document_id = si.sale_id
      JOIN documents d ON d.id = s.document_id
      JOIN products p ON p.id = si.product_id
      LEFT JOIN product_categories c ON c.id = p.category_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
        AND NOT EXISTS (
          SELECT 1 FROM corrections co
          JOIN documents cd ON cd.id = co.document_id
          WHERE co.original_document_id = d.id AND cd.status = 'CONFIRMED'
        )
      GROUP BY p.id, p.sku, p.name, c.name
      HAVING SUM(si.qty - si.returned_qty) <> 0
      ORDER BY revenue DESC
    `;
  }

  /**
   * How much of each product went out in each period, for the XYZ analysis.
   *
   * Bucketed by month: a week is too short for a parts business to say
   * anything about steadiness, and a year is one number.
   */
  productPeriods(period: Period): Promise<ProductPeriodRow[]> {
    return this.prisma.$queryRaw`
      SELECT si.product_id,
             date_trunc('month', d.business_date)::date AS bucket,
             SUM(si.qty - si.returned_qty) AS qty
      FROM sale_items si
      JOIN sales s ON s.document_id = si.sale_id
      JOIN documents d ON d.id = s.document_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
        AND NOT EXISTS (
          SELECT 1 FROM corrections co
          JOIN documents cd ON cd.id = co.document_id
          WHERE co.original_document_id = d.id AND cd.status = 'CONFIRMED'
        )
      GROUP BY si.product_id, date_trunc('month', d.business_date)
      ORDER BY si.product_id, bucket
    `;
  }

  /** Sales day by day, week by week or month by month (§29). */
  salesTrend(period: Period, bucket: 'day' | 'week' | 'month'): Promise<SalesTrendRow[]> {
    // `bucket` is one of three literals this file checks, never caller text.
    const unit = Prisma.raw(`'${bucket}'`);
    return this.prisma.$queryRaw`
      SELECT date_trunc(${unit}, d.business_date)::date AS bucket,
             COUNT(*) AS sales,
             SUM(s.total_amount) AS revenue,
             SUM(s.total_cogs) AS cogs
      FROM sales s
      JOIN documents d ON d.id = s.document_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
        AND NOT EXISTS (
          SELECT 1 FROM corrections co
          JOIN documents cd ON cd.id = co.document_id
          WHERE co.original_document_id = d.id AND cd.status = 'CONFIRMED'
        )
      GROUP BY date_trunc(${unit}, d.business_date)
      ORDER BY bucket
    `;
  }

  /**
   * What needs ordering (§29, §12-Б.4).
   *
   * Against *available* stock, not what is on the shelf: goods held on a live
   * reservation are spoken for (§17), and counting them would say there is
   * enough when there is not. Inbound quantity is what has been ordered and
   * not yet received, so an order already on its way does not produce a
   * second one.
   */
  reorder(soldSince: Date): Promise<ReorderRow[]> {
    return this.prisma.$queryRaw`
      SELECT p.id AS product_id, p.sku, p.name,
             p.min_stock, p.reorder_point,
             COALESCE(stock.qty, 0) AS on_hand,
             COALESCE(held.qty, 0) AS reserved,
             COALESCE(inbound.qty, 0) AS inbound,
             COALESCE(sold.qty, 0) AS sold_recently
      FROM products p
      LEFT JOIN LATERAL (
        SELECT SUM(ls.qty) AS qty
        FROM layer_stock ls
        JOIN fifo_layers l ON l.id = ls.layer_id
        JOIN warehouses w ON w.id = ls.warehouse_id
        WHERE l.product_id = p.id AND w.wtype = 'MAIN'
      ) stock ON true
      LEFT JOIN LATERAL (
        SELECT SUM(ri.qty) AS qty
        FROM reservation_items ri
        JOIN reservations r ON r.document_id = ri.reservation_id
        JOIN documents rd ON rd.id = r.document_id
        WHERE ri.product_id = p.id
          AND r.rstatus = 'ACTIVE'
          AND rd.status = 'CONFIRMED'
          AND r.expires_at > now()
      ) held ON true
      LEFT JOIN LATERAL (
        -- The same definition the product card uses (§12-Б.4): ordered on a
        -- confirmed purchase and not yet received against that same order,
        -- floored at zero so an over-receipt is not negative inbound.
        SELECT SUM(GREATEST(ordered.qty - COALESCE(received.qty, 0), 0)) AS qty
        FROM (
          SELECT i.purchase_id, SUM(i.qty) AS qty
          FROM purchase_items i
          JOIN documents d ON d.id = i.purchase_id
          WHERE i.product_id = p.id AND d.status = 'CONFIRMED'
          GROUP BY i.purchase_id
        ) ordered
        LEFT JOIN (
          SELECT r.purchase_id, SUM(i.received_qty) AS qty
          FROM receipt_items i
          JOIN receipts r ON r.document_id = i.receipt_id
          JOIN documents d ON d.id = r.document_id
          WHERE i.product_id = p.id AND d.status = 'CONFIRMED'
          GROUP BY r.purchase_id
        ) received ON received.purchase_id = ordered.purchase_id
      ) inbound ON true
      LEFT JOIN LATERAL (
        SELECT SUM(si.qty - si.returned_qty) AS qty
        FROM sale_items si
        JOIN sales s ON s.document_id = si.sale_id
        JOIN documents sd ON sd.id = s.document_id
        WHERE si.product_id = p.id
          AND sd.status = 'CONFIRMED'
          AND sd.business_date >= ${soldSince}::date
      ) sold ON true
      WHERE p.is_active
      ORDER BY p.name
    `;
  }
}
