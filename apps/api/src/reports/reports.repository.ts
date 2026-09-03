import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LOGISTICS_SEQUENCE } from '../purchases/logistics-status';
import { goodsAreInTransit } from '../purchases/payable-recognition';

const ZERO = new Prisma.Decimal(0);

/**
 * Excludes a document a confirmed correction has reversed (§27.1).
 *
 * The Cash Flow needs no such rule — the correction posts its own opposite
 * movements and the two cancel. The Profit and Loss reads document bodies
 * instead, so a reversed expense would still be counted as one unless it is
 * left out here.
 *
 * `alias` is the documents alias in the query; it is a literal this file
 * writes, never anything a caller supplies.
 */
function notReversed(alias = 'd'): Prisma.Sql {
  return Prisma.sql`NOT EXISTS (
    SELECT 1 FROM corrections c
    JOIN documents cd ON cd.id = c.document_id
    WHERE c.original_document_id = ${Prisma.raw(alias)}.id
      AND cd.status = 'CONFIRMED'
  )`;
}

export interface Period {
  from: Date;
  to: Date;
}

export interface CashFlowRow {
  doc_type: string;
  currency: string;
  /** 'IN' or 'OUT' — money entering or leaving, never netted against itself. */
  direction: string;
  /** In the account's own currency. */
  amount: Prisma.Decimal;
  /** The som value: the movement's own for a foreign account, else the amount. */
  kgs: Prisma.Decimal;
  documents: bigint;
}

/**
 * Every figure here comes from confirmed documents, dated by business date
 * (Period Lock). Nothing reads a stored balance: a balance is the sum of the
 * movements that made it (§27, §42.3).
 */
@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cash in and out, by document type and currency.
   *
   * A foreign account's som value is the movement's own `kgs_value`, recorded
   * when the money moved at the rate that applied then (§10) — never a
   * today's-rate conversion, which would restate history.
   *
   * Money in and money out are counted apart. A transfer between two som
   * accounts is one document with a plus and a minus, and summing them first
   * would report that nothing happened rather than that 20 000 moved.
   */
  cashFlow(period: Period): Promise<CashFlowRow[]> {
    return this.prisma.$queryRaw<CashFlowRow[]>`
      SELECT d.doc_type::text AS doc_type,
             a.currency::text AS currency,
             CASE WHEN m.amount > 0 THEN 'IN' ELSE 'OUT' END AS direction,
             SUM(m.amount) AS amount,
             SUM(CASE WHEN a.currency = 'KGS' THEN m.amount ELSE COALESCE(m.kgs_value, 0) END) AS kgs,
             COUNT(DISTINCT d.id) AS documents
      FROM account_movements m
      JOIN documents d ON d.id = m.document_id
      JOIN payment_accounts a ON a.id = m.account_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
      GROUP BY d.doc_type, a.currency, CASE WHEN m.amount > 0 THEN 'IN' ELSE 'OUT' END
      ORDER BY d.doc_type, a.currency, direction
    `;
  }

  /**
   * Foreign movements with no som value recorded.
   *
   * They are left out of the som figures rather than added as if they were
   * som. In practice this is empty: only a transfer between two accounts of
   * the same foreign currency has no rate to record, and a transfer changes
   * no total anyway.
   */
  unvaluedForeignMovements(period: Period): Promise<
    { doc_number: string; currency: string; amount: Prisma.Decimal }[]
  > {
    return this.prisma.$queryRaw`
      SELECT d.doc_number, a.currency::text AS currency, m.amount
      FROM account_movements m
      JOIN documents d ON d.id = m.document_id
      JOIN payment_accounts a ON a.id = m.account_id
      WHERE d.status = 'CONFIRMED'
        AND a.currency != 'KGS'
        AND m.kgs_value IS NULL
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
      ORDER BY d.doc_number
    `;
  }

  /**
   * Cash held on a date, per account (§28: som and foreign tills apart).
   *
   * Used two ways: the Balance asks for today, and the Cash Flow asks for the
   * day before a period began, to open where the previous period closed.
   */
  cashOnHand(asOf: Date): Promise<
    {
      account_id: string;
      name: string;
      currency: string;
      type: string;
      amount: Prisma.Decimal;
      kgs: Prisma.Decimal;
    }[]
  > {
    return this.prisma.$queryRaw`
      SELECT a.id AS account_id, a.name, a.currency::text AS currency,
             a.type::text AS type,
             COALESCE(SUM(m.amount), 0) AS amount,
             COALESCE(SUM(
               CASE WHEN a.currency = 'KGS' THEN m.amount ELSE COALESCE(m.kgs_value, 0) END
             ), 0) AS kgs
      FROM payment_accounts a
      LEFT JOIN account_movements m ON m.account_id = a.id
      LEFT JOIN documents d ON d.id = m.document_id
        AND d.status = 'CONFIRMED'
        AND d.business_date <= ${asOf}::date
      WHERE d.id IS NOT NULL OR m.id IS NULL
      GROUP BY a.id, a.name, a.currency, a.type
      ORDER BY a.currency, a.name
    `;
  }

  /** Sales and their FIFO cost over the period (§13.3). */
  async salesResult(
    period: Period,
  ): Promise<{ revenue: Prisma.Decimal; cogs: Prisma.Decimal; count: number }> {
    const [row] = await this.prisma.$queryRaw<
      { revenue: Prisma.Decimal | null; cogs: Prisma.Decimal | null; count: bigint }[]
    >`
      SELECT SUM(s.total_amount) AS revenue,
             SUM(s.total_cogs) AS cogs,
             COUNT(*) AS count
      FROM sales s
      JOIN documents d ON d.id = s.document_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
        AND ${notReversed()}
    `;
    return {
      revenue: row?.revenue ?? ZERO,
      cogs: row?.cogs ?? ZERO,
      count: Number(row?.count ?? 0),
    };
  }

  /**
   * What came back, at the price it was sold for and at what it cost.
   *
   * The cost comes off the period's COGS because the goods are stock again —
   * a return puts them back as a new layer at the original cost (§18.0).
   */
  async returnsResult(
    period: Period,
  ): Promise<{ refunded: Prisma.Decimal; cost: Prisma.Decimal }> {
    const [row] = await this.prisma.$queryRaw<
      { refunded: Prisma.Decimal | null; cost: Prisma.Decimal | null }[]
    >`
      SELECT SUM(r.total_return_amount) AS refunded,
             (SELECT SUM(ri.qty * ri.original_unit_cost)
              FROM return_items ri
              JOIN returns r2 ON r2.document_id = ri.return_id
              JOIN documents d2 ON d2.id = r2.document_id
              WHERE d2.status = 'CONFIRMED'
                AND d2.business_date BETWEEN ${period.from}::date AND ${period.to}::date
                AND ${notReversed('d2')}
             ) AS cost
      FROM returns r
      JOIN documents d ON d.id = r.document_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
        AND ${notReversed()}
    `;
    return { refunded: row?.refunded ?? ZERO, cost: row?.cost ?? ZERO };
  }

  /** Operating expenses by category, plus salaries and bonuses (§25, §26, §23). */
  operatingExpenses(period: Period): Promise<
    { category: string; amount: Prisma.Decimal }[]
  > {
    return this.prisma.$queryRaw`
      SELECT c.name AS category, SUM(e.amount) AS amount
      FROM expenses e
      JOIN expense_categories c ON c.id = e.category_id
      JOIN documents d ON d.id = e.document_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
        AND ${notReversed()}
      GROUP BY c.name

      UNION ALL
      SELECT 'Айлык (§25)', SUM(s.total_paid)
      FROM salary_payments s
      JOIN documents d ON d.id = s.document_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
        AND ${notReversed()}

      UNION ALL
      SELECT 'Сатуучунун бонусу (§23)', SUM(b.amount)
      FROM bonus_payments b
      JOIN documents d ON d.id = b.document_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
        AND ${notReversed()}
    `;
  }

  async otherIncome(period: Period): Promise<Prisma.Decimal> {
    const [row] = await this.prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT SUM(o.amount) AS total
      FROM other_income o
      JOIN documents d ON d.id = o.document_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
        AND ${notReversed()}
    `;
    return row?.total ?? ZERO;
  }

  /**
   * What an inventory adjustment cost, or found (§22).
   *
   * "Недостача жоготуусу өзүнчө статьяга түшөт" — the shortage is a line of
   * its own, and a surplus is its opposite. Both come from the adjustment's
   * own stock movements, at the landed cost of the layer they touched, so the
   * figure is the same one the warehouse saw.
   */
  async inventoryAdjustments(
    period: Period,
  ): Promise<{ shortage: Prisma.Decimal; surplus: Prisma.Decimal }> {
    const [row] = await this.prisma.$queryRaw<
      { shortage: Prisma.Decimal | null; surplus: Prisma.Decimal | null }[]
    >`
      SELECT -SUM(sm.qty * sm.unit_cost) FILTER (WHERE sm.qty < 0) AS shortage,
             SUM(sm.qty * sm.unit_cost) FILTER (WHERE sm.qty > 0) AS surplus
      FROM stock_movements sm
      JOIN documents d ON d.id = sm.document_id
      WHERE d.doc_type = 'INV' AND d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
    `;
    return { shortage: row?.shortage ?? ZERO, surplus: row?.surplus ?? ZERO };
  }

  async writeOffs(period: Period): Promise<Prisma.Decimal> {
    const [row] = await this.prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT SUM(w.total_cost) AS total
      FROM write_offs w
      JOIN documents d ON d.id = w.document_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
        AND ${notReversed()}
    `;
    return row?.total ?? ZERO;
  }

  /**
   * Realised exchange difference (§10.2, §42.8).
   *
   * Recorded where it is realised — when a currency is sold back, and when a
   * supplier or carrier debt is settled at a rate other than the one it was
   * raised at. A rate that moves while the debt still stands changes nothing
   * (§42.8: the landed cost of a received batch is fixed).
   */
  async fxGainLoss(period: Period): Promise<Prisma.Decimal> {
    const [row] = await this.prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT COALESCE(
        (SELECT SUM(x.fx_gain_loss_kgs) FROM currency_exchanges x
         JOIN documents d ON d.id = x.document_id
         WHERE d.status = 'CONFIRMED'
           AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date), 0)
      + COALESCE(
        (SELECT SUM(p.fx_gain_loss_kgs) FROM supplier_payments p
         JOIN documents d ON d.id = p.document_id
         WHERE d.status = 'CONFIRMED'
           AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date), 0)
      + COALESCE(
        (SELECT SUM(c.fx_gain_loss_kgs) FROM cargo_payments c
         JOIN documents d ON d.id = c.document_id
         WHERE d.status = 'CONFIRMED'
           AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date), 0)
      AS total
    `;
    return row?.total ?? ZERO;
  }

  /**
   * Stock at FIFO cost, by warehouse type (§28: MAIN and DEFECT apart).
   *
   * From `layer_stock`, which is what is on the shelf right now — the same
   * figure the stock screens show, so the balance and the warehouse never
   * disagree.
   */
  inventory(): Promise<
    { wtype: string; code: string; value: Prisma.Decimal; qty: Prisma.Decimal }[]
  > {
    return this.prisma.$queryRaw`
      SELECT w.wtype::text AS wtype, w.code,
             SUM(ls.qty * l.unit_cost) AS value,
             SUM(ls.qty) AS qty
      FROM layer_stock ls
      JOIN fifo_layers l ON l.id = ls.layer_id
      JOIN warehouses w ON w.id = ls.warehouse_id
      GROUP BY w.wtype, w.code
      HAVING SUM(ls.qty) <> 0
      ORDER BY w.wtype, w.code
    `;
  }

  /**
   * Goods shipped by the supplier but not yet received (§6.1, §7).
   *
   * From the moment the parts leave the partner's warehouse we owe for them
   * and they owe us the goods, so the debt has an asset facing it: a claim on
   * the supplier for a shipment in transit. It is carried at the value the
   * debt was recognised at, and it leaves this line at the moment the Receipt
   * turns it into stock at its landed cost — never both at once.
   */
  async goodsInTransit(): Promise<Prisma.Decimal> {
    const stages = LOGISTICS_SEQUENCE.filter(goodsAreInTransit) as string[];
    const [row] = await this.prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT -SUM(l.kgs_value) AS total
      FROM supplier_ledger l
      JOIN purchases p ON p.document_id = l.document_id
      JOIN documents d ON d.id = p.document_id
      WHERE l.entry_type = 'PAYABLE'
        AND d.status = 'CONFIRMED'
        AND p.logistics_status::text = ANY(${stages})
        AND ${notReversed()}
    `;
    return row?.total ?? ZERO;
  }

  /** What customers owe (§16). Never mixed with what they have paid ahead. */
  async customerReceivables(): Promise<Prisma.Decimal> {
    const [row] = await this.prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT SUM(s.outstanding_amount) AS total
      FROM sales s
      JOIN documents d ON d.id = s.document_id
      WHERE d.status = 'CONFIRMED' AND s.outstanding_amount > 0
    `;
    return row?.total ?? ZERO;
  }

  /** Customer advances still held (§17-А.5) — a liability of its own. */
  async customerAdvances(): Promise<Prisma.Decimal> {
    const [row] = await this.prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT SUM(a.amount - a.applied_amount - a.refunded_amount) AS total
      FROM advances a
      JOIN documents d ON d.id = a.document_id
      WHERE d.status = 'CONFIRMED'
        AND a.amount - a.applied_amount - a.refunded_amount > 0
    `;
    return row?.total ?? ZERO;
  }

  /**
   * The supplier and carrier ledgers, in their own currencies (§4, §5.2).
   *
   * The ledgers sign a debt negative and a payment positive — a receipt
   * writes the payable as a negative entry and a payment cancels it — so a
   * negative balance is what the business owes and a positive one is money it
   * has paid ahead or is owed back. §28 asks for both, kept apart.
   */
  supplierBalances(): Promise<
    { supplier_id: string; name: string; balance_cny: Prisma.Decimal; kgs: Prisma.Decimal }[]
  > {
    return this.prisma.$queryRaw`
      SELECT s.id AS supplier_id, s.name,
             SUM(l.amount_cny) AS balance_cny,
             SUM(COALESCE(l.kgs_value, 0)) AS kgs
      FROM supplier_ledger l
      JOIN suppliers s ON s.id = l.supplier_id
      GROUP BY s.id, s.name
      HAVING SUM(l.amount_cny) <> 0
      ORDER BY s.name
    `;
  }

  cargoBalances(): Promise<
    { cargo_company_id: string; name: string; balance_usd: Prisma.Decimal; kgs: Prisma.Decimal }[]
  > {
    return this.prisma.$queryRaw`
      SELECT c.id AS cargo_company_id, c.name,
             SUM(l.amount_usd) AS balance_usd,
             SUM(COALESCE(l.kgs_value, 0)) AS kgs
      FROM cargo_ledger l
      JOIN cargo_companies c ON c.id = l.cargo_company_id
      GROUP BY c.id, c.name
      HAVING SUM(l.amount_usd) <> 0
      ORDER BY c.name
    `;
  }

  /** Claims still open against a supplier or a carrier (§8.5). */
  openClaims(): Promise<
    { currency: string; amount: Prisma.Decimal; count: bigint }[]
  > {
    return this.prisma.$queryRaw`
      SELECT c.currency::text AS currency, SUM(c.amount) AS amount, COUNT(*) AS count
      FROM claims c
      JOIN documents d ON d.id = c.document_id
      WHERE d.status = 'CONFIRMED' AND c.cstatus = 'OPEN'
      GROUP BY c.currency
    `;
  }

  /** Capital in and out, in som (§3, §3.1). */
  async capital(): Promise<{
    contributed: Prisma.Decimal;
    withdrawn: Prisma.Decimal;
  }> {
    const [row] = await this.prisma.$queryRaw<
      { contributed: Prisma.Decimal | null; withdrawn: Prisma.Decimal | null }[]
    >`
      SELECT
        COALESCE((
          SELECT SUM(CASE WHEN a.currency = 'KGS' THEN m.amount ELSE COALESCE(m.kgs_value, 0) END)
          FROM account_movements m
          JOIN documents d ON d.id = m.document_id
          JOIN payment_accounts a ON a.id = m.account_id
          WHERE d.doc_type = 'CAP' AND d.status = 'CONFIRMED'), 0) AS contributed,
        COALESCE((
          SELECT -SUM(CASE WHEN a.currency = 'KGS' THEN m.amount ELSE COALESCE(m.kgs_value, 0) END)
          FROM account_movements m
          JOIN documents d ON d.id = m.document_id
          JOIN payment_accounts a ON a.id = m.account_id
          WHERE d.doc_type = 'WDW' AND d.status = 'CONFIRMED'), 0) AS withdrawn
    `;
    return {
      contributed: row?.contributed ?? ZERO,
      withdrawn: row?.withdrawn ?? ZERO,
    };
  }

  /** The earliest business date on record — where "since the beginning" starts. */
  async firstBusinessDate(): Promise<Date | null> {
    const [row] = await this.prisma.$queryRaw<{ first: Date | null }[]>`
      SELECT MIN(business_date) AS first FROM documents WHERE status = 'CONFIRMED'
    `;
    return row?.first ?? null;
  }
}
