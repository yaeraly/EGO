/**
 * The codes the system gives a product, so nobody has to invent one.
 *
 * §12-Б.9.1 requires every active product to have a unique SKU and says
 * nothing about its shape. A code typed by hand is eventually mistyped or
 * repeated, and neither shows up until a receipt or a sale goes to the wrong
 * part — so the server issues both the SKU and the barcode.
 */

/** Used when a product's category has no code of its own. */
export const DEFAULT_SKU_PREFIX = 'PRD';

/**
 * A category code fit for an SKU prefix.
 *
 * Latin letters and digits only, upper case, at most six: an SKU is read
 * aloud across a warehouse and typed into a phone, so it stays in the
 * alphabet a keyboard has by default.
 */
export function normalisePrefix(value: string | null | undefined): string {
  const cleaned = (value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  return cleaned || DEFAULT_SKU_PREFIX;
}

/** PREFIX-NNNNN, e.g. MOT-00042. */
export function formatSku(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(5, '0')}`;
}

/**
 * The check digit that makes a 13-digit barcode scannable.
 *
 * EAN-13: each digit from the right is weighted 3, 1, 3, 1 …, and the check
 * digit is what takes the total to the next multiple of ten.
 */
export function ean13CheckDigit(twelve: string): number {
  if (!/^\d{12}$/.test(twelve)) {
    throw new Error('An EAN-13 body must be exactly 12 digits');
  }
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    const digit = Number(twelve[index]);
    sum += index % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * An in-store barcode for a product (EAN-13).
 *
 * The 20–29 prefix range is reserved by GS1 for exactly this — codes a shop
 * prints for itself, which are never confused with a manufacturer's. The
 * sequence fills the rest, so a barcode belongs to one product for good.
 */
export function formatBarcode(sequence: number): string {
  if (sequence < 0 || sequence > 9_999_999_999) {
    throw new Error('Barcode sequence out of range');
  }
  const body = `20${String(sequence).padStart(10, '0')}`;
  return `${body}${ean13CheckDigit(body)}`;
}
