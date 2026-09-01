import { Injectable } from '@nestjs/common';
import { Prisma, user_role } from '@prisma/client';
import { CreditService } from '../credit/credit.service';
import { currentBusinessDate } from '../documents/business-date';
import { AnalyticsService } from './analytics.service';
import { PerformanceRepository } from './performance.repository';
import { PerformanceService } from './performance.service';
import { money, sum } from './report-math';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

const ZERO = new Prisma.Decimal(0);

export interface Dashboard {
  as_of: string;
  /** Today, and this month so far (§32). */
  today: { sales: number; revenue: string; profit: string };
  month: { sales: number; revenue: string; profit: string };
  cash: {
    total_kgs: string;
    by_currency: { currency: string; amount: string; kgs: string }[];
    /** What is still in the salespeople's own tills (§19). */
    with_sellers_kgs: string;
  };
  customers: {
    receivables: string;
    overdue: string;
    overdue_count: number;
    advances: string;
  };
  suppliers: {
    payable_cny: string;
    payable_kgs: string;
    cargo_payable_usd: string;
    cargo_payable_kgs: string;
    open_claims: string;
    open_claims_count: number;
  };
  stock: {
    qty: string;
    value_kgs: string;
    main_value_kgs: string;
    defect_value_kgs: string;
    /** How many products are at or under their reorder level (§29). */
    low_count: number;
    low: { product_id: string; name: string; available: string; inbound: string }[];
  };
  top_selling: { product_id: string; name: string; qty: string; revenue: string }[];
  most_profitable: { product_id: string; name: string; margin: string; margin_pct: string | null }[];
  sellers: {
    user_id: string;
    full_name: string;
    revenue: string;
    margin: string;
    sales: number;
    plan_pct: string | null;
  }[];
  business_plan_pct: string | null;
}

/**
 * The OWNER's one screen (§32).
 *
 * Nothing here is calculated a second way: every figure comes from the same
 * service that owns it — the statements for money earned, the analyses for
 * products, the credit module for what is overdue. A dashboard that computed
 * its own totals would eventually disagree with the report it summarises,
 * and the person reading it would have no way to tell which was right.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly reports: ReportsService,
    private readonly repository: ReportsRepository,
    private readonly analytics: AnalyticsService,
    private readonly performance: PerformanceService,
    private readonly performanceRepository: PerformanceRepository,
    private readonly credit: CreditService,
  ) {}

  async load(): Promise<Dashboard> {
    const today = currentBusinessDate();
    const monthStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );

    const [
      todayResult,
      monthResult,
      cash,
      sellerAccounts,
      overdue,
      advances,
      suppliers,
      cargo,
      claims,
      inventory,
      reorder,
      products,
      sellers,
    ] = await Promise.all([
      this.reports.profitAndLoss({ from: today, to: today }),
      this.reports.profitAndLoss({ from: monthStart, to: today }),
      this.repository.cashOnHand(today),
      this.performanceRepository.sellerAccounts(),
      this.credit.overdueDebts(),
      this.repository.customerAdvances(),
      this.repository.supplierBalances(),
      this.repository.cargoBalances(),
      this.repository.openClaims(),
      this.repository.inventory(),
      this.analytics.reorder(),
      this.analytics.products({ from: monthStart, to: today }),
      this.performance.sellers({ from: monthStart, to: today }),
    ]);

    const byCurrency = new Map<
      string,
      { amount: Prisma.Decimal; kgs: Prisma.Decimal }
    >();
    for (const account of cash) {
      const running = byCurrency.get(account.currency) ?? {
        amount: ZERO,
        kgs: ZERO,
      };
      byCurrency.set(account.currency, {
        amount: running.amount.plus(account.amount),
        kgs: running.kgs.plus(account.kgs),
      });
    }

    // §16.4 — a debt whose day has passed and which is still open.
    const overdueTotal = overdue.reduce<Prisma.Decimal>(
      (total, sale) => total.plus(sale.outstanding_amount),
      ZERO,
    );
    const receivables = await this.repository.customerReceivables();

    // The ledgers sign a debt negative (§4.3, §8.2).
    const owed = <T extends { kgs: Prisma.Decimal }>(rows: T[]) =>
      rows.filter((row) => row.kgs.isNegative());
    const supplierOwed = owed(suppliers);
    const cargoOwed = owed(cargo);

    const mainValue = sum(
      ...inventory.filter((row) => row.wtype !== 'DEFECT').map((row) => row.value),
    );
    const defectValue = sum(
      ...inventory.filter((row) => row.wtype === 'DEFECT').map((row) => row.value),
    );

    return {
      as_of: today.toISOString().slice(0, 10),
      today: {
        sales: todayResult.sales_count,
        revenue: todayResult.net_revenue,
        profit: todayResult.net_profit,
      },
      month: {
        sales: monthResult.sales_count,
        revenue: monthResult.net_revenue,
        profit: monthResult.net_profit,
      },
      cash: {
        total_kgs: money(sum(...cash.map((account) => account.kgs))),
        by_currency: [...byCurrency.entries()].map(([currency, totals]) => ({
          currency,
          amount: money(totals.amount),
          kgs: money(totals.kgs),
        })),
        // §32 asks what is still with the salespeople. The OWNER's own till
        // is already theirs, so it is not money waiting to be handed in.
        with_sellers_kgs: money(
          sum(
            ...sellerAccounts
              .filter(
                (account) =>
                  account.currency === 'KGS' && account.role !== user_role.OWNER,
              )
              .map((account) => account.balance),
          ),
        ),
      },
      customers: {
        receivables: money(receivables),
        overdue: money(overdueTotal),
        overdue_count: overdue.length,
        advances: money(advances),
      },
      suppliers: {
        payable_cny: money(
          sum(...supplierOwed.map((row) => row.balance_cny.abs())),
        ),
        payable_kgs: money(sum(...supplierOwed.map((row) => row.kgs.abs()))),
        cargo_payable_usd: money(
          sum(...cargoOwed.map((row) => row.balance_usd.abs())),
        ),
        cargo_payable_kgs: money(sum(...cargoOwed.map((row) => row.kgs.abs()))),
        open_claims: money(sum(...claims.map((row) => row.amount))),
        open_claims_count: claims.reduce(
          (total, row) => total + Number(row.count),
          0,
        ),
      },
      stock: {
        qty: sum(...inventory.map((row) => row.qty)).toFixed(2),
        value_kgs: money(mainValue.plus(defectValue)),
        main_value_kgs: money(mainValue),
        defect_value_kgs: money(defectValue),
        low_count: reorder.products.length,
        low: reorder.products.slice(0, 5).map((product) => ({
          product_id: product.product_id,
          name: product.name,
          available: product.available,
          inbound: product.inbound,
        })),
      },
      top_selling: [...products.products]
        .sort((a, b) => Number(b.qty) - Number(a.qty))
        .slice(0, 5)
        .map((product) => ({
          product_id: product.product_id,
          name: product.name,
          qty: product.qty,
          revenue: product.revenue,
        })),
      most_profitable: [...products.products]
        .sort((a, b) => Number(b.margin) - Number(a.margin))
        .slice(0, 5)
        .map((product) => ({
          product_id: product.product_id,
          name: product.name,
          margin: product.margin,
          margin_pct: product.margin_pct,
        })),
      sellers: sellers.sellers.map((seller) => ({
        user_id: seller.user_id,
        full_name: seller.full_name,
        revenue: seller.revenue,
        margin: seller.margin,
        sales: seller.sales,
        plan_pct: seller.achievement.revenue_pct,
      })),
      business_plan_pct: sellers.business_achievement.revenue_pct,
    };
  }
}
