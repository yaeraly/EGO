import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/**
 * How far along a target something is, in percent (§24).
 *
 * Null when there is no target: an unset plan is not a plan of zero, and
 * dividing by it would report either 0% or infinity, both of which read as
 * facts about performance rather than about a missing plan.
 */
export function achievement(
  actual: Prisma.Decimal,
  target: Prisma.Decimal | null | undefined,
): string | null {
  if (!target || target.lessThanOrEqualTo(ZERO)) {
    return null;
  }
  return actual
    .times(HUNDRED)
    .dividedBy(target)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

/**
 * The average sale (§31 — "орточо чек").
 *
 * Null when nothing was sold: an average of nothing is not zero.
 */
export function averageSale(
  revenue: Prisma.Decimal,
  count: number,
): string | null {
  if (count <= 0) {
    return null;
  }
  return revenue
    .dividedBy(new Prisma.Decimal(count))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

/**
 * How often a customer buys, in days between purchases (§30 — "сатып алуу
 * жыштыгы").
 *
 * The span from their first purchase to their last, divided by the gaps
 * between them. One purchase has no frequency — there is no gap to measure —
 * and neither has a customer whose purchases all fall on one day.
 */
export function purchaseFrequencyDays(params: {
  first: Date | null;
  last: Date | null;
  purchases: number;
}): string | null {
  if (!params.first || !params.last || params.purchases < 2) {
    return null;
  }
  const span = Math.round(
    (params.last.getTime() - params.first.getTime()) / 86_400_000,
  );
  if (span <= 0) {
    return null;
  }
  return new Prisma.Decimal(span)
    .dividedBy(new Prisma.Decimal(params.purchases - 1))
    .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(1);
}
