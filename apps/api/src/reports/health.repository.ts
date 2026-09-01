import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stock that has not moved, and what it is worth (§34).
   *
   * On the shelf and nothing sold in the window. The value is what matters:
   * §34 asks which goods are tying money up, and money is the unit that
   * question is asked in.
   */
  deadStock(since: Date): Promise<
    {
      product_id: string;
      sku: string;
      name: string;
      qty: Prisma.Decimal;
      value: Prisma.Decimal;
      last_sold: Date | null;
    }[]
  > {
    return this.prisma.$queryRaw`
      SELECT p.id AS product_id, p.sku, p.name,
             SUM(ls.qty) AS qty,
             SUM(ls.qty * l.unit_cost) AS value,
             sold.last_sold
      FROM layer_stock ls
      JOIN fifo_layers l ON l.id = ls.layer_id
      JOIN warehouses w ON w.id = ls.warehouse_id
      JOIN products p ON p.id = l.product_id
      LEFT JOIN LATERAL (
        SELECT MAX(d.business_date) AS last_sold
        FROM sale_items si
        JOIN sales s ON s.document_id = si.sale_id
        JOIN documents d ON d.id = s.document_id
        WHERE si.product_id = p.id AND d.status = 'CONFIRMED'
      ) sold ON true
      WHERE w.wtype = 'MAIN'
      GROUP BY p.id, p.sku, p.name, sold.last_sold
      HAVING SUM(ls.qty) > 0
         AND (sold.last_sold IS NULL OR sold.last_sold < ${since}::date)
      ORDER BY value DESC
    `;
  }

  /** Claims still open, and how long they have stood (§8.5, §34). */
  openClaims(): Promise<
    {
      document_id: string;
      doc_number: string;
      ctype: string;
      amount: Prisma.Decimal;
      currency: string;
      age_days: number;
      counterparty: string | null;
    }[]
  > {
    return this.prisma.$queryRaw`
      SELECT c.document_id, d.doc_number, c.ctype::text AS ctype,
             c.amount, c.currency::text AS currency,
             (CURRENT_DATE - d.business_date) AS age_days,
             COALESCE(s.name, cc.name) AS counterparty
      FROM claims c
      JOIN documents d ON d.id = c.document_id
      LEFT JOIN suppliers s ON s.id = c.supplier_id
      LEFT JOIN cargo_companies cc ON cc.id = c.cargo_company_id
      WHERE d.status = 'CONFIRMED' AND c.cstatus = 'OPEN'
      ORDER BY age_days DESC
    `;
  }

  /**
   * Differences that were written down and never resolved (§20, §22, §34).
   *
   * A cash count that did not match, and a stock count that did not either.
   * Both are recorded facts with a reason; §34 asks the OWNER to be shown
   * where the books and the world disagreed.
   */
  cashDifferences(since: Date): Promise<
    {
      business_date: Date;
      full_name: string;
      difference: Prisma.Decimal;
      difference_reason: string | null;
    }[]
  > {
    return this.prisma.$queryRaw`
      SELECT h.business_date, u.full_name, h.difference, h.difference_reason
      FROM daily_cash_handovers h
      JOIN users u ON u.id = h.user_id
      WHERE h.difference <> 0 AND h.business_date >= ${since}::date
      ORDER BY h.business_date DESC
    `;
  }

  inventoryDifferences(since: Date): Promise<
    {
      document_id: string;
      doc_number: string;
      business_date: Date;
      lines: bigint;
      value: Prisma.Decimal;
    }[]
  > {
    return this.prisma.$queryRaw`
      SELECT d.id AS document_id, d.doc_number, d.business_date,
             COUNT(*) AS lines,
             SUM(ABS(sm.qty * sm.unit_cost)) AS value
      FROM stock_movements sm
      JOIN documents d ON d.id = sm.document_id
      WHERE d.doc_type = 'INV' AND d.status = 'CONFIRMED'
        AND d.business_date >= ${since}::date
      GROUP BY d.id, d.doc_number, d.business_date
      ORDER BY d.business_date DESC
    `;
  }
}
