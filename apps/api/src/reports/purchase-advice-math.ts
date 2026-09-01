import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);

/**
 * The suggestion, as arithmetic (§33).
 *
 * §33's own example is this and nothing more: "калдык 12 даана, орточо сатуу
 * 18 даана/ай, жеткирүү мөөнөтү X күн. Сунушталган заказ: Y даана." Order
 * enough to cover the wait for the goods plus the stretch after they arrive,
 * less what is on the shelf and what is already on its way.
 *
 * Nothing is smoothed, weighted or forecast. Every input is a figure the
 * business can point at, and the answer can be checked on paper — which is
 * what makes it safe to act on.
 */
export interface AdviceInput {
  /** Units sold per day, measured over a window of real sales. */
  dailyRate: Prisma.Decimal;
  /** Days from ordering to the goods being on the shelf, measured (§6). */
  leadDays: number;
  /** How long after arrival the order should last — the OWNER's choice. */
  coverDays: number;
  /** On the shelf and not spoken for (§17). */
  available: Prisma.Decimal;
  /** Ordered and not yet received (§12-Б.4). */
  inbound: Prisma.Decimal;
  /** Held on live reservations — demand already asked for (§17). */
  reserved: Prisma.Decimal;
  /**
   * The floor the OWNER set for this product (§12-Б.4).
   *
   * A minimum means "never below this", so a slow month does not argue it
   * away: what the horizon will consume, or the minimum, whichever is more.
   * Without it the assistant would say "order nothing" about the very
   * products the reorder list is flagging.
   */
  minStock: Prisma.Decimal;
}

export interface Advice {
  /** What the wait plus the cover period is expected to consume. */
  needed: string;
  /** What to order, whole units, never negative. */
  suggested: string;
  /** Days the available stock lasts at this rate; null when nothing sells. */
  cover_days: string | null;
}

export function adviseQuantity(input: AdviceInput): Advice {
  const horizon = new Prisma.Decimal(input.leadDays + input.coverDays);
  // Reserved stock is demand that has already been asked for, so it is added
  // to what the horizon will consume rather than counted as supply.
  const demand = input.dailyRate.times(horizon).plus(input.reserved);
  const needed = Prisma.Decimal.max(demand, input.minStock);
  const shortfall = needed.minus(input.available).minus(input.inbound);

  return {
    needed: needed.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
    // Whole units, rounded up: half a battery is no use to anyone.
    suggested: Prisma.Decimal.max(shortfall, ZERO)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_CEIL)
      .toFixed(0),
    cover_days: coverDays(input.available, input.dailyRate),
  };
}

/**
 * How long what is on the shelf lasts.
 *
 * Null when nothing is selling: stock that never moves has no cover period,
 * it has a different problem (§34).
 */
export function coverDays(
  available: Prisma.Decimal,
  dailyRate: Prisma.Decimal,
): string | null {
  if (dailyRate.lessThanOrEqualTo(ZERO)) {
    return null;
  }
  return available
    .dividedBy(dailyRate)
    .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(1);
}

export type AdvicePriority = 'URGENT' | 'SOON' | 'LATER' | 'HOLD';

/**
 * How badly it is wanted (§33 — "приоритет").
 *
 * The question is only ever "will it run out before a new order can arrive",
 * so the lead time is the yardstick. What earns most is the tie-breaker, not
 * the measure: a class-A product running out costs more than a class-C one,
 * but a class-C product with nothing left still stops a sale.
 */
export function advicePriority(params: {
  suggested: string;
  coverDays: string | null;
  leadDays: number;
  abc: 'A' | 'B' | 'C';
}): AdvicePriority {
  if (Number(params.suggested) <= 0) {
    return 'HOLD';
  }
  if (params.coverDays === null) {
    // It is short of its own minimum but nothing is selling: order it last.
    return 'LATER';
  }

  const cover = Number(params.coverDays);
  if (cover <= params.leadDays) {
    // It runs out before a new order could possibly arrive.
    return 'URGENT';
  }
  if (cover <= params.leadDays * 2 || params.abc === 'A') {
    return 'SOON';
  }
  return 'LATER';
}
