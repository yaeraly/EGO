import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { currentBusinessDate } from '../documents/business-date';
import { PrismaService } from '../prisma/prisma.service';
import { SettingKey } from '../settings/setting-keys';
import { SettingsService } from '../settings/settings.service';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRepository } from './analytics.repository';
import {
  Advice,
  AdvicePriority,
  adviseQuantity,
  advicePriority,
} from './purchase-advice-math';
import { PurchaseAdviceRepository } from './purchase-advice.repository';
import { money, sum } from './report-math';

const ZERO = new Prisma.Decimal(0);

export interface ProductAdvice extends Advice {
  product_id: string;
  sku: string;
  name: string;
  supplier_id: string | null;
  supplier_name: string | null;
  /** What the shelf holds, what is spoken for, what is on its way. */
  on_hand: string;
  reserved: string;
  available: string;
  inbound: string;
  /** Units a day, measured over the window. */
  daily_rate: string;
  monthly_rate: string;
  sold_in_window: string;
  lead_days: number;
  abc: 'A' | 'B' | 'C';
  xyz: 'X' | 'Y' | 'Z' | null;
  margin_pct: string | null;
  last_price_cny: string | null;
  estimated_cost_cny: string | null;
  priority: AdvicePriority;
  /** Why this line reads as it does, in one sentence. */
  reason: string;
}

export interface PurchaseAdviceReport {
  as_of: string;
  window_days: number;
  cover_days: number;
  /** Measured from the logistics history (§6); null when nothing has arrived yet. */
  lead_days: number | null;
  lead_days_source: 'MEASURED' | 'SETTING' | 'UNKNOWN';
  batches_measured: number;
  budget: {
    estimated_cny: string;
    available_cny: string;
    /** What is short, if the till cannot cover the whole suggestion. */
    shortfall_cny: string;
  };
  order: ProductAdvice[];
  hold: ProductAdvice[];
}

/**
 * The purchasing assistant (§33).
 *
 * It answers §33's question with §33's own arithmetic: what is on the shelf,
 * how fast it sells, how long delivery takes — therefore how much to order.
 * Everything it uses is measured from documents the business already has, and
 * the reason for every line is written out beside it, because a suggestion
 * nobody can check is a suggestion nobody should follow.
 *
 * What it does not do is forecast. §33 also lists seasonality, and seasonality
 * needs years of history and a stated method; guessing at it would dress a
 * number up as knowledge.
 */
@Injectable()
export class PurchaseAdviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PurchaseAdviceRepository,
    private readonly analyticsRepository: AnalyticsRepository,
    private readonly analytics: AnalyticsService,
    private readonly settings: SettingsService,
  ) {}

  async advise(): Promise<PurchaseAdviceReport> {
    const today = currentBusinessDate();

    const [windowDays, coverDays, fallbackLead] = await Promise.all([
      this.settings.optionalDecimal(SettingKey.PURCHASE_VELOCITY_WINDOW_DAYS),
      this.settings.optionalDecimal(SettingKey.PURCHASE_COVER_DAYS),
      this.settings.optionalDecimal(SettingKey.PURCHASE_FALLBACK_LEAD_DAYS),
    ]);
    const window = wholeDays(windowDays) ?? 90;
    const cover = wholeDays(coverDays) ?? 60;

    const since = new Date(today);
    since.setUTCDate(since.getUTCDate() - window);

    const [leadTimes, velocity, prices, availableCny, stock, products, suppliers] =
      await Promise.all([
        this.repository.leadTimes(),
        this.repository.salesVelocity(since, today),
        this.repository.lastPrices(),
        this.repository.availableCny(),
        this.analyticsRepository.reorder(since),
        this.analytics.products({ from: since, to: today }),
        this.suppliersByName(),
      ]);

    const overall = leadTimes.find((row) => row.supplier_id === null);
    const leadBySupplier = new Map(
      leadTimes
        .filter((row) => row.supplier_id !== null)
        .map((row) => [row.supplier_id as string, row.days]),
    );
    const defaultLead = overall?.days ?? wholeDays(fallbackLead) ?? null;
    const leadSource: PurchaseAdviceReport['lead_days_source'] = overall
      ? 'MEASURED'
      : fallbackLead
        ? 'SETTING'
        : 'UNKNOWN';

    const velocityByProduct = new Map(velocity.map((row) => [row.product_id, row]));
    const priceByProduct = new Map(prices.map((row) => [row.product_id, row]));
    const classByProduct = new Map(
      products.products.map((row) => [row.product_id, row]),
    );

    const advice: ProductAdvice[] = [];
    for (const row of stock) {
      const sold = velocityByProduct.get(row.product_id);
      const price = priceByProduct.get(row.product_id);
      const analysis = classByProduct.get(row.product_id);
      const supplierId = price?.supplier_id ?? null;
      const unitPrice = price?.price_cny ?? null;
      const lead =
        (supplierId ? leadBySupplier.get(supplierId) : undefined) ??
        defaultLead ??
        0;

      // Days the window really covers for this product: something first sold
      // last week has not had a quarter to sell in.
      const soldDays = sold
        ? Math.max(
            1,
            Math.round(
              (today.getTime() - sold.first_sold.getTime()) / 86_400_000,
            ) + 1,
          )
        : window;
      const dailyRate = sold
        ? sold.qty.dividedBy(new Prisma.Decimal(Math.min(soldDays, window)))
        : ZERO;

      const available = row.on_hand.minus(row.reserved);
      const quantities = adviseQuantity({
        dailyRate,
        leadDays: lead,
        coverDays: cover,
        available,
        inbound: row.inbound,
        reserved: row.reserved,
        minStock: row.min_stock,
      });
      const abc = analysis?.abc ?? 'C';
      const priority = advicePriority({
        suggested: quantities.suggested,
        coverDays: quantities.cover_days,
        leadDays: lead,
        abc,
      });

      const estimated = unitPrice
        ? unitPrice
            .times(new Prisma.Decimal(quantities.suggested))
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        : null;

      advice.push({
        ...quantities,
        product_id: row.product_id,
        sku: row.sku,
        name: row.name,
        supplier_id: supplierId,
        supplier_name: supplierId ? (suppliers.get(supplierId) ?? null) : null,
        on_hand: row.on_hand.toFixed(2),
        reserved: row.reserved.toFixed(2),
        available: available.toFixed(2),
        inbound: row.inbound.toFixed(2),
        daily_rate: dailyRate.toDecimalPlaces(3).toFixed(3),
        monthly_rate: dailyRate
          .times(30)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          .toFixed(2),
        sold_in_window: (sold?.qty ?? ZERO).toFixed(2),
        lead_days: lead,
        abc,
        xyz: analysis?.xyz ?? null,
        margin_pct: analysis?.margin_pct ?? null,
        last_price_cny: unitPrice?.toFixed(2) ?? null,
        estimated_cost_cny: estimated?.toFixed(2) ?? null,
        priority,
        reason: this.explain({
          priority,
          quantities,
          lead,
          cover,
          dailyRate,
          inbound: row.inbound,
        }),
      });
    }

    const order = advice
      .filter((row) => row.priority !== 'HOLD')
      .sort(byPriority);
    const hold = advice.filter((row) => row.priority === 'HOLD');

    const estimatedTotal = sum(
      ...order.map((row) =>
        row.estimated_cost_cny ? new Prisma.Decimal(row.estimated_cost_cny) : ZERO,
      ),
    );

    return {
      as_of: today.toISOString().slice(0, 10),
      window_days: window,
      cover_days: cover,
      lead_days: defaultLead,
      lead_days_source: leadSource,
      batches_measured: Number(overall?.batches ?? 0),
      budget: {
        estimated_cny: money(estimatedTotal),
        available_cny: money(availableCny),
        shortfall_cny: money(
          Prisma.Decimal.max(estimatedTotal.minus(availableCny), ZERO),
        ),
      },
      order,
      hold,
    };
  }

  private explain(params: {
    priority: AdvicePriority;
    quantities: Advice;
    lead: number;
    cover: number;
    dailyRate: Prisma.Decimal;
    inbound: Prisma.Decimal;
  }): string {
    if (params.priority === 'HOLD') {
      return params.inbound.greaterThan(0)
        ? `Жолдогу ${params.inbound.toFixed(2)} даана ${params.lead + params.cover} күнгө жетет — азырынча заказ керек эмес.`
        : `Калдык ${params.lead + params.cover} күнгө жетет — азырынча заказ керек эмес.`;
    }
    if (params.quantities.cover_days === null) {
      return 'Бул мезгилде сатылган жок — минимумга чейин гана толтуруу керек.';
    }
    const rate = params.dailyRate
      .times(30)
      .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(1);
    return (
      `Айына ~${rate} даана сатылат, калдык ${params.quantities.cover_days} күнгө жетет, ` +
      `жеткирүү ${params.lead} күн. ${params.lead} + ${params.cover} күндү жабуу үчүн ` +
      `${params.quantities.suggested} даана керек.`
    );
  }

  private async suppliersByName(): Promise<Map<string, string>> {
    const suppliers = await this.prisma.suppliers.findMany({
      select: { id: true, name: true },
    });
    return new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  }
}

/**
 * A setting that means a number of days, as a whole number.
 *
 * Days are a count, not money, so they are allowed to be numbers — but the
 * conversion still goes through Decimal's own rounding rather than a string
 * round-trip, which is the habit the money rule exists to prevent.
 */
function wholeDays(value: Prisma.Decimal | null): number | null {
  return value ? value.round().toNumber() : null;
}

const ORDER: Record<AdvicePriority, number> = {
  URGENT: 0,
  SOON: 1,
  LATER: 2,
  HOLD: 3,
};

/** Most urgent first, and within a rank the biggest order first. */
function byPriority(a: ProductAdvice, b: ProductAdvice): number {
  const rank = ORDER[a.priority] - ORDER[b.priority];
  if (rank !== 0) {
    return rank;
  }
  return new Prisma.Decimal(b.estimated_cost_cny ?? 0).comparedTo(
    new Prisma.Decimal(a.estimated_cost_cny ?? 0),
  );
}
