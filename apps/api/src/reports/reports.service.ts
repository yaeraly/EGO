import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { currentBusinessDate } from '../documents/business-date';
import { PrismaService } from '../prisma/prisma.service';
import {
  CashFlowCategory,
  cashFlowCategory,
  correctionCashFlowCategory,
} from './cash-flow-category';
import {
  BalanceTotals,
  ProfitAndLoss,
  balanceTotals,
  money,
  profitAndLoss,
  sum,
} from './report-math';
import { Period, ReportsRepository } from './reports.repository';

const ZERO = new Prisma.Decimal(0);

export interface CashFlowLine {
  doc_type: string;
  currency: string;
  direction: 'IN' | 'OUT';
  amount: string;
  kgs: string;
  documents: number;
}

export interface CashFlowSection {
  category: CashFlowCategory;
  in_kgs: string;
  out_kgs: string;
  net_kgs: string;
  lines: CashFlowLine[];
}

export interface CashFlowReport {
  from: string;
  to: string;
  opening_cash_kgs: string;
  sections: CashFlowSection[];
  /** Everything but the internal moves, which change no total (§19). */
  net_change_kgs: string;
  closing_cash_kgs: string;
  /** Foreign movements with no recorded som value; empty in ordinary use. */
  unvalued: { doc_number: string; currency: string; amount: string }[];
}

export interface ProfitAndLossReport extends ProfitAndLoss {
  from: string;
  to: string;
  sales_count: number;
  expense_lines: { category: string; amount: string }[];
  /**
   * §3.1.5–6 — what an owner took out, stated and excluded.
   *
   * It is shown so nobody has to wonder whether it was quietly included: it
   * is real money out of the business, and it is not an expense.
   */
  owner_withdrawals_excluded: string;
}

export interface BalanceReport extends BalanceTotals {
  as_of: string;
  cash: {
    account_id: string;
    name: string;
    currency: string;
    type: string;
    amount: string;
    kgs: string;
  }[];
  cash_total_kgs: string;
  inventory: { wtype: string; code: string; qty: string; value: string }[];
  inventory_main: string;
  inventory_defect: string;
  inventory_total: string;
  customer_receivables: string;
  customer_advances: string;
  supplier_payable: { name: string; balance_cny: string; kgs: string }[];
  supplier_payable_total_kgs: string;
  supplier_receivable_total_kgs: string;
  cargo_payable: { name: string; balance_usd: string; kgs: string }[];
  cargo_payable_total_kgs: string;
  cargo_receivable_total_kgs: string;
  open_claims: { currency: string; amount: string; count: number }[];
  open_claims_total: string;
  capital_contributed: string;
  capital_withdrawn: string;
  retained_earnings: string;
}

/**
 * The three financial statements §28 asks for.
 *
 * They read documents and nothing else. There is no stored profit and no
 * stored balance to drift out of step: every figure is the sum of the
 * documents behind it, which is what §27 and §42.3 are for.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ReportsRepository,
  ) {}

  /**
   * Cash Flow (§28), split operating / investing / capital-financing.
   *
   * A correction has no category of its own — it borrows the category of the
   * document it reverses (§27.1), so undoing an expense shows as an operating
   * inflow rather than as a category no reader would recognise.
   */
  async cashFlow(period: Period): Promise<CashFlowReport> {
    const [rows, unvalued, openingAccounts, closingAccounts, corrections] =
      await Promise.all([
        this.repository.cashFlow(period),
        this.repository.unvaluedForeignMovements(period),
        this.repository.cashOnHand(dayBefore(period.from)),
        this.repository.cashOnHand(period.to),
        this.correctionCategories(period),
      ]);

    const sections = new Map<CashFlowCategory, CashFlowSection>();
    for (const category of Object.values(CashFlowCategory)) {
      sections.set(category, {
        category,
        in_kgs: '0.00',
        out_kgs: '0.00',
        net_kgs: '0.00',
        lines: [],
      });
    }
    const totals = new Map<CashFlowCategory, { in: Prisma.Decimal; out: Prisma.Decimal }>();

    for (const row of rows) {
      const category =
        row.doc_type === 'COR'
          ? (corrections ?? CashFlowCategory.OPERATING)
          : cashFlowCategory(row.doc_type as never);
      if (!category) {
        continue;
      }
      const section = sections.get(category)!;
      section.lines.push({
        doc_type: row.doc_type,
        currency: row.currency,
        direction: row.direction === 'IN' ? 'IN' : 'OUT',
        amount: money(row.amount),
        kgs: money(row.kgs),
        documents: Number(row.documents),
      });
      const running = totals.get(category) ?? { in: ZERO, out: ZERO };
      totals.set(
        category,
        row.direction === 'OUT'
          ? { in: running.in, out: running.out.plus(row.kgs.abs()) }
          : { in: running.in.plus(row.kgs), out: running.out },
      );
    }

    let net = ZERO;
    for (const [category, section] of sections) {
      const running = totals.get(category) ?? { in: ZERO, out: ZERO };
      section.in_kgs = money(running.in);
      section.out_kgs = money(running.out);
      section.net_kgs = money(running.in.minus(running.out));
      // A transfer between the company's own accounts moves no total (§19).
      if (category !== CashFlowCategory.INTERNAL_TRANSFER) {
        net = net.plus(running.in).minus(running.out);
      }
    }

    const opening = sum(...openingAccounts.map((account) => account.kgs));
    const closing = sum(...closingAccounts.map((account) => account.kgs));

    return {
      from: iso(period.from),
      to: iso(period.to),
      opening_cash_kgs: money(opening),
      sections: [...sections.values()],
      net_change_kgs: money(net),
      closing_cash_kgs: money(closing),
      unvalued: unvalued.map((row) => ({
        doc_number: row.doc_number,
        currency: row.currency,
        amount: money(row.amount),
      })),
    };
  }

  /** Profit and Loss (§28, §3.1.5, §42.8). */
  async profitAndLoss(period: Period): Promise<ProfitAndLossReport> {
    const [
      sales,
      returns,
      expenses,
      otherIncome,
      writeOffs,
      inventory,
      fx,
      withdrawals,
    ] = await Promise.all([
      this.repository.salesResult(period),
      this.repository.returnsResult(period),
      this.repository.operatingExpenses(period),
      this.repository.otherIncome(period),
      this.repository.writeOffs(period),
      this.repository.inventoryAdjustments(period),
      this.repository.fxGainLoss(period),
      this.withdrawalsInPeriod(period),
    ]);

    const lines = expenses.filter((line) => line.amount && !line.amount.isZero());
    const operatingExpenses = sum(...lines.map((line) => line.amount));

    return {
      from: iso(period.from),
      to: iso(period.to),
      sales_count: sales.count,
      expense_lines: lines
        .map((line) => ({ category: line.category, amount: money(line.amount) }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
      owner_withdrawals_excluded: money(withdrawals),
      ...profitAndLoss({
        revenue: sales.revenue,
        returns: returns.refunded,
        cogs: sales.cogs,
        returnedCost: returns.cost,
        operatingExpenses,
        otherIncome,
        writeOffs,
        inventoryResult: inventory.shortage.minus(inventory.surplus),
        fxGainLoss: fx,
      }),
    };
  }

  /**
   * Balance (§28).
   *
   * It is the position now, not on a chosen date: what is on the shelf, what
   * customers owe, what is held against advances and what is owed to
   * suppliers are all current figures, and dating one of them without the
   * others would produce a balance that never existed.
   *
   * Retained earnings are the profit since the first document, computed the
   * same way as the Profit and Loss report — not a stored number. The
   * difference between assets, liabilities and equity is reported rather than
   * absorbed, because a difference means something moved without a document.
   */
  async balance(): Promise<BalanceReport> {
    const asOf = currentBusinessDate();
    const [
      cash,
      inventory,
      receivables,
      advances,
      suppliers,
      cargo,
      claims,
      capital,
      firstDate,
    ] = await Promise.all([
      this.repository.cashOnHand(asOf),
      this.repository.inventory(),
      this.repository.customerReceivables(),
      this.repository.customerAdvances(),
      this.repository.supplierBalances(),
      this.repository.cargoBalances(),
      this.repository.openClaims(),
      this.repository.capital(),
      this.repository.firstBusinessDate(),
    ]);

    const sinceTheBeginning = await this.profitAndLoss({
      from: firstDate ?? asOf,
      to: asOf,
    });
    const retained = new Prisma.Decimal(sinceTheBeginning.net_profit);

    const main = sum(
      ...inventory.filter((row) => row.wtype === 'MAIN').map((row) => row.value),
    );
    const defect = sum(
      ...inventory.filter((row) => row.wtype === 'DEFECT').map((row) => row.value),
    );
    const otherStock = sum(
      ...inventory
        .filter((row) => row.wtype !== 'MAIN' && row.wtype !== 'DEFECT')
        .map((row) => row.value),
    );

    // The ledgers carry a debt as a negative balance and a prepayment as a
    // positive one (§4.3, §8.2), so the sign decides which side of the
    // balance the counterparty belongs on.
    const owing = <T extends { kgs: Prisma.Decimal }>(rows: T[]) =>
      rows.filter((row) => row.kgs.isNegative());
    const owed = <T extends { kgs: Prisma.Decimal }>(rows: T[]) =>
      rows.filter((row) => row.kgs.greaterThan(0));

    const supplierPayable = sum(...owing(suppliers).map((row) => row.kgs.abs()));
    const supplierReceivable = sum(...owed(suppliers).map((row) => row.kgs));
    const cargoPayable = sum(...owing(cargo).map((row) => row.kgs.abs()));
    const cargoReceivable = sum(...owed(cargo).map((row) => row.kgs));
    const claimTotal = sum(...claims.map((row) => row.amount));
    const cashTotal = sum(...cash.map((row) => row.kgs));

    const totals = balanceTotals({
      cash: cashTotal,
      inventoryMain: main.plus(otherStock),
      inventoryDefect: defect,
      customerReceivables: receivables,
      supplierReceivables: supplierReceivable,
      cargoReceivables: cargoReceivable,
      openClaims: claimTotal,
      supplierPayable,
      cargoPayable,
      customerAdvances: advances,
      capitalIn: capital.contributed,
      capitalOut: capital.withdrawn,
      retainedEarnings: retained,
    });

    return {
      as_of: iso(asOf),
      cash: cash.map((row) => ({
        account_id: row.account_id,
        name: row.name,
        currency: row.currency,
        type: row.type,
        amount: money(row.amount),
        kgs: money(row.kgs),
      })),
      cash_total_kgs: money(cashTotal),
      inventory: inventory.map((row) => ({
        wtype: row.wtype,
        code: row.code,
        qty: row.qty.toFixed(2),
        value: money(row.value),
      })),
      inventory_main: money(main.plus(otherStock)),
      inventory_defect: money(defect),
      inventory_total: money(main.plus(otherStock).plus(defect)),
      customer_receivables: money(receivables),
      customer_advances: money(advances),
      supplier_payable: owing(suppliers).map((row) => ({
        name: row.name,
        balance_cny: money(row.balance_cny.abs()),
        kgs: money(row.kgs.abs()),
      })),
      supplier_payable_total_kgs: money(supplierPayable),
      supplier_receivable_total_kgs: money(supplierReceivable),
      cargo_payable: owing(cargo).map((row) => ({
        name: row.name,
        balance_usd: money(row.balance_usd.abs()),
        kgs: money(row.kgs.abs()),
      })),
      cargo_payable_total_kgs: money(cargoPayable),
      cargo_receivable_total_kgs: money(cargoReceivable),
      open_claims: claims.map((row) => ({
        currency: row.currency,
        amount: money(row.amount),
        count: Number(row.count),
      })),
      open_claims_total: money(claimTotal),
      capital_contributed: money(capital.contributed),
      capital_withdrawn: money(capital.withdrawn),
      retained_earnings: money(retained),
      ...totals,
    };
  }

  /**
   * The one category a correction in this period belongs to.
   *
   * Corrections are rare, and one report line for them all is what a reader
   * wants; when a period holds corrections of different kinds the operating
   * section takes them, which is where all but a capital reversal belong.
   */
  private async correctionCategories(
    period: Period,
  ): Promise<CashFlowCategory | null> {
    const rows = await this.prisma.$queryRaw<{ doc_type: string }[]>`
      SELECT DISTINCT o.doc_type::text AS doc_type
      FROM corrections c
      JOIN documents d ON d.id = c.document_id
      JOIN documents o ON o.id = c.original_document_id
      WHERE d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
    `;
    const categories = new Set(
      rows
        .map((row) => correctionCashFlowCategory(row.doc_type as never))
        .filter((category): category is CashFlowCategory => category !== null),
    );
    return categories.size === 1 ? [...categories][0] : null;
  }

  private async withdrawalsInPeriod(period: Period): Promise<Prisma.Decimal> {
    const [row] = await this.prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT -SUM(CASE WHEN a.currency = 'KGS' THEN m.amount ELSE COALESCE(m.kgs_value, 0) END) AS total
      FROM account_movements m
      JOIN documents d ON d.id = m.document_id
      JOIN payment_accounts a ON a.id = m.account_id
      WHERE d.doc_type = 'WDW' AND d.status = 'CONFIRMED'
        AND d.business_date BETWEEN ${period.from}::date AND ${period.to}::date
        AND NOT EXISTS (
          SELECT 1 FROM corrections c
          JOIN documents cd ON cd.id = c.document_id
          WHERE c.original_document_id = d.id AND cd.status = 'CONFIRMED'
        )
    `;
    return row?.total ?? ZERO;
  }
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayBefore(date: Date): Date {
  const previous = new Date(date);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous;
}
