import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/**
 * What a sale earns its seller (§23).
 *
 *   Bonus Base      = Sale Revenue − FIFO COGS − sale-specific adjustments
 *   Calculated Bonus = Bonus Base × Bonus Rate
 *
 * Margin, not turnover: §23 opens by saying so, and it is the whole point —
 * a seller who discounts to the floor earns nothing extra for the volume.
 *
 * §23.5 fixes the two inputs at the moment of sale. A supplier paid later at
 * a different exchange rate moves the company's money, not this sale's
 * margin, so FX gain or loss never reaches here; nor does a claim written off
 * (§8.5).
 */
export function bonusBase(params: {
  revenue: Prisma.Decimal;
  fifoCogs: Prisma.Decimal;
  /** §13.6 — a loss sale has no bonus base at all, never a negative one. */
  isLossSale?: boolean;
}): Prisma.Decimal {
  if (params.isLossSale) {
    return ZERO;
  }
  return Prisma.Decimal.max(params.revenue.minus(params.fifoCogs), ZERO);
}

export function calculatedBonus(
  base: Prisma.Decimal,
  ratePct: Prisma.Decimal,
): Prisma.Decimal {
  return base
    .times(ratePct)
    .dividedBy(HUNDRED)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * What is left to pay after any adjustment (§23.4).
 *
 * Never below zero: an over-refunded bonus is a debt to settle out of the
 * next one (§23.4), not a negative payable that could quietly be handed over.
 */
export function payableAmount(
  calculated: Prisma.Decimal,
  adjustment: Prisma.Decimal,
): Prisma.Decimal {
  return Prisma.Decimal.max(calculated.minus(adjustment), ZERO);
}

/**
 * The share of a sale line that a return takes back (§23.4).
 *
 * The margin comes off in the same proportion as the goods: the line's own
 * price and its own FIFO cost, for the quantity returned.
 */
export function returnedMargin(params: {
  qty: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}): Prisma.Decimal {
  return Prisma.Decimal.max(
    params.unitPrice
      .minus(params.unitCost)
      .times(params.qty)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    ZERO,
  );
}
