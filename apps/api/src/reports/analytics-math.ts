import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

export type AbcClass = 'A' | 'B' | 'C';
export type XyzClass = 'X' | 'Y' | 'Z';

export interface AbcThresholds {
  /** Cumulative share of revenue that defines class A, in percent. */
  aPct: Prisma.Decimal;
  /** ...and where B ends. Everything after is C. */
  bPct: Prisma.Decimal;
}

export interface XyzThresholds {
  /** Coefficient of variation, in percent, below which demand counts as steady. */
  xPct: Prisma.Decimal;
  yPct: Prisma.Decimal;
}

/**
 * ABC (§29).
 *
 * Products are ranked by what they brought in, and each takes the class its
 * running share of the total falls into: the few that earn most of the money
 * are A, the tail is C. A product that earned nothing is C — it cannot be
 * anything else, and dividing by a zero total would say nothing at all.
 *
 * The item that crosses a boundary belongs to the class it crosses *into*,
 * which is the usual reading: the product that takes the running total past
 * 80% is still one of the ones that make up the first 80%.
 */
export function classifyAbc<T>(
  rows: T[],
  valueOf: (row: T) => Prisma.Decimal,
  thresholds: AbcThresholds,
): { row: T; value: Prisma.Decimal; share_pct: string; cumulative_pct: string; abc: AbcClass }[] {
  const ranked = [...rows].sort((a, b) => valueOf(b).comparedTo(valueOf(a)));
  const total = ranked.reduce<Prisma.Decimal>(
    (sum, row) => sum.plus(valueOf(row)),
    ZERO,
  );

  let running = ZERO;
  return ranked.map((row) => {
    const value = valueOf(row);
    running = running.plus(value);

    if (total.lessThanOrEqualTo(ZERO)) {
      return {
        row,
        value,
        share_pct: '0.00',
        cumulative_pct: '0.00',
        abc: 'C' as AbcClass,
      };
    }

    const share = value.times(HUNDRED).dividedBy(total);
    const cumulative = running.times(HUNDRED).dividedBy(total);
    const previous = cumulative.minus(share);

    // The boundary is crossed *by* this item, so it belongs to the class the
    // running total was still in before it was added.
    const abc: AbcClass = previous.lessThan(thresholds.aPct)
      ? 'A'
      : previous.lessThan(thresholds.bPct)
        ? 'B'
        : 'C';

    return {
      row,
      value,
      share_pct: share.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
      cumulative_pct: cumulative
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(2),
      abc,
    };
  });
}

/**
 * How much a product's demand moves about, as a percentage of its average
 * (§29 — the XYZ analysis).
 *
 * The population standard deviation over the periods, divided by the mean.
 * Steady demand is worth stocking to a rule; erratic demand is not, which is
 * the whole reason the analysis is asked for.
 *
 * Null when there is nothing to measure: fewer than two periods, or an
 * average of zero. A single month of sales says nothing about steadiness, and
 * saying "X" for it would be a guess wearing a letter.
 */
export function coefficientOfVariation(
  periods: Prisma.Decimal[],
): Prisma.Decimal | null {
  if (periods.length < 2) {
    return null;
  }
  const count = new Prisma.Decimal(periods.length);
  const mean = periods
    .reduce<Prisma.Decimal>((sum, value) => sum.plus(value), ZERO)
    .dividedBy(count);
  if (mean.lessThanOrEqualTo(ZERO)) {
    return null;
  }

  const variance = periods
    .reduce<Prisma.Decimal>(
      (sum, value) => sum.plus(value.minus(mean).pow(2)),
      ZERO,
    )
    .dividedBy(count);

  return variance.sqrt().times(HUNDRED).dividedBy(mean);
}

export function classifyXyz(
  cv: Prisma.Decimal | null,
  thresholds: XyzThresholds,
): XyzClass | null {
  if (cv === null) {
    return null;
  }
  if (cv.lessThanOrEqualTo(thresholds.xPct)) {
    return 'X';
  }
  return cv.lessThanOrEqualTo(thresholds.yPct) ? 'Y' : 'Z';
}

/**
 * Margin as a percentage of what was charged (§29).
 *
 * Of revenue, not of cost: it is the share of the sale the business keeps,
 * which is the figure a price is judged by. Zero revenue has no margin
 * percentage — not 0%, which would read as "sold at cost".
 */
export function marginPct(
  revenue: Prisma.Decimal,
  margin: Prisma.Decimal,
): string | null {
  if (revenue.lessThanOrEqualTo(ZERO)) {
    return null;
  }
  return margin
    .times(HUNDRED)
    .dividedBy(revenue)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(2);
}
