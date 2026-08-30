import { doc_type } from '@prisma/client';

/**
 * Document Numbering Standard: PREFIX-YYYY-NNNNNN.
 *
 * The prefix is the document type itself (the reference schema's `doc_type`
 * enum is the list of 27 prefixes), the year is the document's business year,
 * and the counter is six digits, zero-padded, restarting each year.
 */
export const SEQUENCE_DIGITS = 6;

export function formatDocumentNumber(
  docType: doc_type,
  year: number,
  sequence: number,
): string {
  return `${docType}-${year}-${String(sequence).padStart(SEQUENCE_DIGITS, '0')}`;
}

/**
 * The sequence year is taken from the business date, not the wall clock: a
 * document booked to 31 December belongs to that year's sequence even if it is
 * entered after midnight.
 */
export function sequenceYear(businessDate: Date): number {
  return businessDate.getUTCFullYear();
}
