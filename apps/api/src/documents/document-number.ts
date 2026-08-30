import { doc_type } from '@prisma/client';

/**
 * Document Numbering Standard: PREFIX-YYYY-NNNNNN.
 *
 * The prefix is the document type itself (the reference schema's `doc_type`
 * enum is the list of 27 prefixes), and the counter is six digits, zero-padded.
 */
export const SEQUENCE_DIGITS = 6;

/** Kyrgyzstan (Bishkek) — the knowledge base's stated timezone (Period Lock). */
export const BUSINESS_TIMEZONE = 'Asia/Bishkek';

export function formatDocumentNumber(
  docType: doc_type,
  year: number,
  sequence: number,
): string {
  return `${docType}-${year}-${String(sequence).padStart(SEQUENCE_DIGITS, '0')}`;
}

/**
 * The sequence year is the year the document is *created*, in Bishkek time —
 * not the year of its business date.
 *
 * The Numbering Standard says "YYYY — документ түзүлгөн жыл" and restarts each
 * counter "when a new calendar year begins". Business Date and Created Date are
 * deliberately separate (Period Lock), so the two can disagree: a sale booked
 * to 31 December but entered at 00:30 on 1 January before day close is
 * business-dated 31 December and numbered in the new year.
 */
export function sequenceYear(createdAt: Date = new Date()): number {
  const year = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
  }).format(createdAt);
  return Number(year);
}

/** Today's calendar date in Bishkek, as YYYY-MM-DD. */
export function bishkekDateKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
