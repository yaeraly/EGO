import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Monetary and percentage values cross the API boundary as decimal *strings*,
 * never as JSON numbers.
 *
 * JSON numbers are IEEE-754 doubles: 0.1 + 0.2 is not 0.3, and a 14-digit
 * amount silently loses precision. Parsing a string straight into
 * Prisma.Decimal keeps every value exact from request to database.
 */
export const DECIMAL_PATTERN = /^-?\d{1,18}(\.\d{1,6})?$/;

export const DECIMAL_MESSAGE =
  'must be a decimal string, e.g. "1500.00" (not a JSON number)';

export function toDecimal(value: string, field: string): Prisma.Decimal {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new BadRequestException(`${field} ${DECIMAL_MESSAGE}`);
  }
  return new Prisma.Decimal(value);
}

export function toOptionalDecimal(
  value: string | undefined,
  field: string,
): Prisma.Decimal | undefined {
  return value === undefined ? undefined : toDecimal(value, field);
}
