import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlansService } from '../plans/plans.service';
import { marginPct } from './analytics-math';
import {
  achievement,
  averageSale,
  purchaseFrequencyDays,
} from './performance-math';
import { PerformanceRepository } from './performance.repository';
import { money } from './report-math';
import { Period } from './reports.repository';

const ZERO = new Prisma.Decimal(0);

export interface SellerPerformance {
  user_id: string;
  full_name: string;
  sales: number;
  revenue: string;
  cogs: string;
  margin: string;
  margin_pct: string | null;
  average_sale: string | null;
  credit_sales: number;
  credit_revenue: string;
  new_customers: number;
  plan: {
    revenue_target: string | null;
    margin_target: string | null;
    new_customers_target: number | null;
  } | null;
  achievement: {
    revenue_pct: string | null;
    margin_pct: string | null;
    new_customers_pct: string | null;
  };
  /** §23 — what they have earned, by the state it is in. */
  bonus: Record<string, string>;
  accounts: { name: string; currency: string; balance: string }[];
}

export interface SellerReport {
  from: string;
  to: string;
  business_plan: {
    revenue_target: string | null;
    margin_target: string | null;
    new_customers_target: number | null;
  } | null;
  business_achievement: {
    revenue_pct: string | null;
    margin_pct: string | null;
    new_customers_pct: string | null;
  };
  totals: { sales: number; revenue: string; margin: string; new_customers: number };
  sellers: SellerPerformance[];
}

export interface CustomerPerformance {
  customer_id: string;
  name: string;
  ctype: string;
  category: string;
  purchases: number;
  revenue: string;
  cogs: string;
  margin: string;
  margin_pct: string | null;
  debt: string;
  last_purchase: string | null;
  frequency_days: string | null;
  reservations: Record<string, number>;
}

export interface CustomerReport {
  from: string;
  to: string;
  customers: CustomerPerformance[];
  top_by_revenue: CustomerPerformance[];
  top_by_margin: CustomerPerformance[];
  lapsed_since: string;
  lapsed: {
    customer_id: string;
    name: string;
    phone: string | null;
    purchases: number;
    revenue: string;
    last_purchase: string;
  }[];
}

/**
 * Who sells and who buys (§30, §31, §24).
 *
 * The plan sits beside the result rather than inside it: §24 asks for the
 * percentage achieved, and a percentage means nothing without both numbers in
 * view. A month with no plan shows the result and no percentage — which is
 * the honest way to say that nothing was asked for.
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly repository: PerformanceRepository,
    private readonly plans: PlansService,
  ) {}

  async sellers(period: Period): Promise<SellerReport> {
    const [rows, accounts, bonuses] = await Promise.all([
      this.repository.sellers(period),
      this.repository.sellerAccounts(),
      this.repository.sellerBonuses(),
    ]);

    // The plan of the month the period ends in — §24 makes plans monthly.
    const year = period.to.getUTCFullYear();
    const month = period.to.getUTCMonth() + 1;
    const businessPlan = await this.plans.find(year, month, null);

    const byUser = new Map<string, { name: string; currency: string; balance: Prisma.Decimal }[]>();
    for (const account of accounts) {
      const list = byUser.get(account.user_id) ?? [];
      list.push(account);
      byUser.set(account.user_id, list);
    }

    const bonusByUser = new Map<string, Record<string, string>>();
    for (const row of bonuses) {
      const standing = bonusByUser.get(row.employee_id) ?? {};
      standing[row.bstatus] = money(row.amount);
      bonusByUser.set(row.employee_id, standing);
    }

    const sellers: SellerPerformance[] = [];
    for (const row of rows) {
      const plan = await this.plans.find(year, month, row.user_id);
      const margin = row.revenue.minus(row.cogs);
      const sales = Number(row.sales);
      const newCustomers = Number(row.new_customers);

      sellers.push({
        user_id: row.user_id,
        full_name: row.full_name,
        sales,
        revenue: money(row.revenue),
        cogs: money(row.cogs),
        margin: money(margin),
        margin_pct: marginPct(row.revenue, margin),
        average_sale: averageSale(row.revenue, sales),
        credit_sales: Number(row.credit_sales),
        credit_revenue: money(row.credit_revenue),
        new_customers: newCustomers,
        plan: plan
          ? {
              revenue_target: plan.revenue_target?.toFixed(2) ?? null,
              margin_target: plan.margin_target?.toFixed(2) ?? null,
              new_customers_target: plan.new_customers_target,
            }
          : null,
        achievement: {
          revenue_pct: achievement(row.revenue, plan?.revenue_target),
          margin_pct: achievement(margin, plan?.margin_target),
          new_customers_pct: achievement(
            new Prisma.Decimal(newCustomers),
            plan?.new_customers_target
              ? new Prisma.Decimal(plan.new_customers_target)
              : null,
          ),
        },
        bonus: bonusByUser.get(row.user_id) ?? {},
        accounts: (byUser.get(row.user_id) ?? []).map((account) => ({
          name: account.name,
          currency: account.currency,
          balance: money(account.balance),
        })),
      });
    }

    const revenue = rows.reduce<Prisma.Decimal>((s, r) => s.plus(r.revenue), ZERO);
    const cogs = rows.reduce<Prisma.Decimal>((s, r) => s.plus(r.cogs), ZERO);
    const newTotal = rows.reduce((s, r) => s + Number(r.new_customers), 0);

    return {
      from: iso(period.from),
      to: iso(period.to),
      business_plan: businessPlan
        ? {
            revenue_target: businessPlan.revenue_target?.toFixed(2) ?? null,
            margin_target: businessPlan.margin_target?.toFixed(2) ?? null,
            new_customers_target: businessPlan.new_customers_target,
          }
        : null,
      business_achievement: {
        revenue_pct: achievement(revenue, businessPlan?.revenue_target),
        margin_pct: achievement(revenue.minus(cogs), businessPlan?.margin_target),
        new_customers_pct: achievement(
          new Prisma.Decimal(newTotal),
          businessPlan?.new_customers_target
            ? new Prisma.Decimal(businessPlan.new_customers_target)
            : null,
        ),
      },
      totals: {
        sales: rows.reduce((s, r) => s + Number(r.sales), 0),
        revenue: money(revenue),
        margin: money(revenue.minus(cogs)),
        new_customers: newTotal,
      },
      sellers,
    };
  }

  /**
   * Customers (§30).
   *
   * The debt and the reservation record are the customer's whole history, not
   * the period's: what someone owes is owed today whenever it was sold, and a
   * cancellation habit is not something one month shows.
   */
  async customers(period: Period, lapsedDays = 90): Promise<CustomerReport> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - lapsedDays);

    const [rows, debts, reservations, lapsed] = await Promise.all([
      this.repository.customers(period),
      this.repository.customerDebts(),
      this.repository.customerReservations(),
      this.repository.lapsedCustomers(since),
    ]);

    const debtByCustomer = new Map(
      debts.map((row) => [row.customer_id, row.debt]),
    );
    const reservationsByCustomer = new Map<string, Record<string, number>>();
    for (const row of reservations) {
      const counts = reservationsByCustomer.get(row.customer_id) ?? {};
      counts[row.rstatus] = Number(row.count);
      reservationsByCustomer.set(row.customer_id, counts);
    }

    const customers: CustomerPerformance[] = rows.map((row) => {
      const margin = row.revenue.minus(row.cogs);
      return {
        customer_id: row.customer_id,
        name: row.name,
        ctype: row.ctype,
        category: row.category,
        purchases: Number(row.purchases),
        revenue: money(row.revenue),
        cogs: money(row.cogs),
        margin: money(margin),
        margin_pct: marginPct(row.revenue, margin),
        debt: money(debtByCustomer.get(row.customer_id) ?? ZERO),
        last_purchase: row.last_purchase?.toISOString().slice(0, 10) ?? null,
        frequency_days: purchaseFrequencyDays({
          first: row.first_purchase,
          last: row.last_purchase,
          purchases: Number(row.purchases),
        }),
        reservations: reservationsByCustomer.get(row.customer_id) ?? {},
      };
    });

    return {
      from: iso(period.from),
      to: iso(period.to),
      customers,
      top_by_revenue: [...customers]
        .sort((a, b) => Number(b.revenue) - Number(a.revenue))
        .slice(0, 10),
      top_by_margin: [...customers]
        .sort((a, b) => Number(b.margin) - Number(a.margin))
        .slice(0, 10),
      lapsed_since: iso(since),
      lapsed: lapsed.map((row) => ({
        customer_id: row.customer_id,
        name: row.name,
        phone: row.phone,
        purchases: Number(row.purchases),
        revenue: money(row.revenue),
        last_purchase: row.last_purchase.toISOString().slice(0, 10),
      })),
    };
  }
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
