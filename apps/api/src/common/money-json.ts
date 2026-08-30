import { Prisma } from '@prisma/client';

/**
 * Renders money at its full scale on the way out.
 *
 * A Prisma Decimal serialises as the shortest string that represents it, so
 * 5000.00 leaves as "5000" while -8600.55 leaves as "-8600.55". Both are
 * correct numbers and neither is a correct *amount*: a screen showing "5 000
 * CNY" next to "8 600.55 CNY" reads as two different kinds of figure. Scale
 * is presentation, so it is fixed here at the boundary rather than in the
 * ledger, where the stored value already has the scale the column defines.
 */
export function money(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

/** The same, for a column that cannot be null. */
export function requiredMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}
