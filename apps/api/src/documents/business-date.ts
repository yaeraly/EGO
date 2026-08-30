import { BadRequestException } from '@nestjs/common';
import { BUSINESS_TIMEZONE } from './document-number';

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

/**
 * Today, as the business reckons it (Period Lock: "убакыт алкагы — Кыргызстан
 * убактысы (Бишкек)").
 *
 * The server stores instants in UTC; which *day* an operation belongs to is a
 * Bishkek question. At 20:00 UTC it is already tomorrow in Bishkek, and a
 * document created then belongs to tomorrow's business day.
 */
export function currentBusinessDate(now: Date = new Date()): Date {
  // en-CA renders as YYYY-MM-DD, which is the shape parseBusinessDate wants.
  const localDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseBusinessDate(localDay);
}

/**
 * The business date a document is booked to.
 *
 * Period Lock: "Business Date демейки боюнча = документ түзүлгөн календардык
 * күн". Callers may still name a date — backdating within an open period is
 * legitimate, and the Period Lock refuses it once the day is closed.
 *
 * (Booking to the previous day after midnight while it is still open is Day
 * Close's job, in Priority 2.)
 */
export function resolveBusinessDate(value?: string | null): Date {
  return value ? parseBusinessDate(value) : currentBusinessDate();
}
