import { BadRequestException } from '@nestjs/common';

/**
 * A business date is a calendar day, not an instant.
 *
 * It is parsed at UTC midnight so the day a document belongs to never shifts
 * with the server's timezone — the Period Lock and the yearly sequence both
 * depend on it landing on exactly one day.
 */
const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseBusinessDate(value: string): Date {
  if (!BUSINESS_DATE_PATTERN.test(value)) {
    throw new BadRequestException('business_date must be YYYY-MM-DD');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('business_date is not a valid date');
  }
  return date;
}
