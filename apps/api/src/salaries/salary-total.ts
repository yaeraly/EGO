import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);

export interface SalaryParts {
  base: Prisma.Decimal;
  bonus: Prisma.Decimal;
  advance: Prisma.Decimal;
  deduction: Prisma.Decimal;
}

/**
 * What is actually handed over (§25).
 *
 *   total = base + bonus − advance − deduction
 *
 * The advance is money the employee already has, so it comes off what is paid
 * now; the deduction is what §25 calls a lawful or agreed withholding. The
 * figure is computed here and nowhere typed in — a salary total that can be
 * typed is a salary total that can be wrong.
 */
export function salaryTotal(parts: SalaryParts): Prisma.Decimal {
  return parts.base
    .plus(parts.bonus)
    .minus(parts.advance)
    .minus(parts.deduction)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** True when the parts leave nothing to hand over — or worse, less than nothing. */
export function isPayable(total: Prisma.Decimal): boolean {
  return total.greaterThan(ZERO);
}
