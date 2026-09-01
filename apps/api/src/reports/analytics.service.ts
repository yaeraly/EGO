import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SettingKey } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import {
  AbcClass,
  XyzClass,
  classifyAbc,
  classifyXyz,
  coefficientOfVariation,
  marginPct,
} from './analytics-math';
import { money } from './report-math';
import { AnalyticsRepository } from './analytics.repository';
import { Period } from './reports.repository';

const ZERO = new Prisma.Decimal(0);

/** The conventional cut-offs, used when the OWNER has set none (§29). */
const DEFAULTS = {
  abcA: new Prisma.Decimal(80),
  abcB: new Prisma.Decimal(95),
  xyzX: new Prisma.Decimal(10),
  xyzY: new Prisma.Decimal(25),
};

export interface ProductAnalysis {
  product_id: string;
  sku: string;
  name: string;
  category: string | null;
  qty: string;
  revenue: string;
  cogs: string;
  margin: string;
  margin_pct: string | null;
  sales: number;
  last_sold: string | null;
  share_pct: string;
  cumulative_pct: string;
  abc: AbcClass;
  /** How much demand moved about, in percent of its average. */
  variation_pct: string | null;
  xyz: XyzClass | null;
  /** How many months of the period this product sold in at all. */
  months: number;
}

export interface ProductAnalysisReport {
  from: string;
  to: string;
  thresholds: {
    abc_a_pct: string;
    abc_b_pct: string;
    xyz_x_pct: string;
    xyz_y_pct: string;
  };
  totals: { qty: string; revenue: string; cogs: string; margin: string; margin_pct: string | null };
  products: ProductAnalysis[];
}

export interface SalesTrendReport {
  from: string;
  to: string;
  bucket: 'day' | 'week' | 'month';
  points: {
    bucket: string;
    sales: number;
    revenue: string;
    cogs: string;
    margin: string;
  }[];
}

export interface ReorderReport {
  as_of: string;
  /** How far back the "sold recently" figure looks. */
  window_days: number;
  products: {
    product_id: string;
    sku: string;
    name: string;
    min_stock: string;
    reorder_point: string;
    on_hand: string;
    reserved: string;
    available: string;
    inbound: string;
    sold_recently: string;
    /** BELOW_MINIMUM is worse than AT_REORDER_POINT; both need ordering. */
    reason: 'BELOW_MINIMUM' | 'AT_REORDER_POINT';
  }[];
}

/**
 * The analytical reports (§29).
 *
 * ABC and XYZ answer different questions and are meant to be read together:
 * one says how much a product is worth, the other how predictable it is. A
 * steady, valuable product (AX) is worth a standing order; an erratic, cheap
 * one (CZ) is worth ordering only when someone asks.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly settings: SettingsService,
  ) {}

  async products(period: Period): Promise<ProductAnalysisReport> {
    const [rows, periods, thresholds] = await Promise.all([
      this.repository.productSales(period),
      this.repository.productPeriods(period),
      this.thresholds(),
    ]);

    // Quantity per month, per product — what the XYZ analysis measures.
    const byProduct = new Map<string, Prisma.Decimal[]>();
    for (const row of periods) {
      const series = byProduct.get(row.product_id) ?? [];
      series.push(row.qty);
      byProduct.set(row.product_id, series);
    }

    const ranked = classifyAbc(rows, (row) => row.revenue, {
      aPct: thresholds.abcA,
      bPct: thresholds.abcB,
    });

    const products = ranked.map((entry) => {
      const row = entry.row;
      const margin = row.revenue.minus(row.cogs);
      const series = byProduct.get(row.product_id) ?? [];
      const cv = coefficientOfVariation(series);

      return {
        product_id: row.product_id,
        sku: row.sku,
        name: row.name,
        category: row.category,
        qty: row.qty.toFixed(2),
        revenue: money(row.revenue),
        cogs: money(row.cogs),
        margin: money(margin),
        margin_pct: marginPct(row.revenue, margin),
        sales: Number(row.sales),
        last_sold: row.last_sold?.toISOString().slice(0, 10) ?? null,
        share_pct: entry.share_pct,
        cumulative_pct: entry.cumulative_pct,
        abc: entry.abc,
        variation_pct:
          cv?.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2) ?? null,
        xyz: classifyXyz(cv, { xPct: thresholds.xyzX, yPct: thresholds.xyzY }),
        months: series.length,
      };
    });

    const revenue = rows.reduce<Prisma.Decimal>((s, r) => s.plus(r.revenue), ZERO);
    const cogs = rows.reduce<Prisma.Decimal>((s, r) => s.plus(r.cogs), ZERO);

    return {
      from: iso(period.from),
      to: iso(period.to),
      thresholds: {
        abc_a_pct: thresholds.abcA.toFixed(2),
        abc_b_pct: thresholds.abcB.toFixed(2),
        xyz_x_pct: thresholds.xyzX.toFixed(2),
        xyz_y_pct: thresholds.xyzY.toFixed(2),
      },
      totals: {
        qty: rows.reduce<Prisma.Decimal>((s, r) => s.plus(r.qty), ZERO).toFixed(2),
        revenue: money(revenue),
        cogs: money(cogs),
        margin: money(revenue.minus(cogs)),
        margin_pct: marginPct(revenue, revenue.minus(cogs)),
      },
      products,
    };
  }

  async salesTrend(
    period: Period,
    bucket: 'day' | 'week' | 'month',
  ): Promise<SalesTrendReport> {
    const rows = await this.repository.salesTrend(period, bucket);
    return {
      from: iso(period.from),
      to: iso(period.to),
      bucket,
      points: rows.map((row) => ({
        bucket: iso(row.bucket),
        sales: Number(row.sales),
        revenue: money(row.revenue),
        cogs: money(row.cogs),
        margin: money(row.revenue.minus(row.cogs)),
      })),
    };
  }

  /**
   * What to order (§29, §12-Б.4).
   *
   * Against available stock, because reserved goods are already someone
   * else's (§17). Inbound is shown rather than subtracted: whether an order
   * already on its way is enough is a judgment the buyer makes with the lead
   * time in front of them, and the knowledge base gives no rule for it.
   */
  async reorder(windowDays = 30): Promise<ReorderReport> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - windowDays);
    const rows = await this.repository.reorder(since);

    const products = rows
      .map((row) => {
        const available = row.on_hand.minus(row.reserved);
        return { row, available };
      })
      .filter(
        ({ row, available }) =>
          (row.min_stock.greaterThan(0) && available.lessThan(row.min_stock)) ||
          (row.reorder_point.greaterThan(0) &&
            available.lessThanOrEqualTo(row.reorder_point)),
      )
      .map(({ row, available }) => ({
        product_id: row.product_id,
        sku: row.sku,
        name: row.name,
        min_stock: row.min_stock.toFixed(2),
        reorder_point: row.reorder_point.toFixed(2),
        on_hand: row.on_hand.toFixed(2),
        reserved: row.reserved.toFixed(2),
        available: available.toFixed(2),
        inbound: row.inbound.toFixed(2),
        sold_recently: row.sold_recently.toFixed(2),
        reason:
          row.min_stock.greaterThan(0) && available.lessThan(row.min_stock)
            ? ('BELOW_MINIMUM' as const)
            : ('AT_REORDER_POINT' as const),
      }))
      .sort((a, b) => Number(a.available) - Number(b.available));

    return {
      as_of: iso(new Date()),
      window_days: windowDays,
      products,
    };
  }

  private async thresholds(): Promise<{
    abcA: Prisma.Decimal;
    abcB: Prisma.Decimal;
    xyzX: Prisma.Decimal;
    xyzY: Prisma.Decimal;
  }> {
    const [abcA, abcB, xyzX, xyzY] = await Promise.all([
      this.settings.optionalDecimal(SettingKey.ABC_A_THRESHOLD_PCT),
      this.settings.optionalDecimal(SettingKey.ABC_B_THRESHOLD_PCT),
      this.settings.optionalDecimal(SettingKey.XYZ_X_THRESHOLD_PCT),
      this.settings.optionalDecimal(SettingKey.XYZ_Y_THRESHOLD_PCT),
    ]);
    return {
      abcA: abcA ?? DEFAULTS.abcA,
      abcB: abcB ?? DEFAULTS.abcB,
      xyzX: xyzX ?? DEFAULTS.xyzX,
      xyzY: xyzY ?? DEFAULTS.xyzY,
    };
  }
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
