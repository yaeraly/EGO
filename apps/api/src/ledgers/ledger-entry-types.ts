/**
 * Supplier ledger entry types (§4.2, §4.3, §8.2, §8.3).
 *
 * The ledger is in CNY and its sign convention is: negative = we owe the
 * supplier, positive = the supplier owes us (a prepayment or a receivable).
 * The supplier's balance is simply the sum.
 */
export const SupplierEntry = {
  /** A confirmed Purchase — we owe for the goods ordered. Negative. */
  PAYABLE: 'PAYABLE',
  /** The part of an SPY that closed open debt. Positive. */
  PAYMENT: 'PAYMENT',
  /** The part of an SPY beyond the debt — an advance (§4.3). Positive. */
  PREPAYMENT: 'PREPAYMENT',
  /** An advance consumed by a later Receipt (§4.3). Module 3. Negative. */
  PREPAYMENT_APPLY: 'PREPAYMENT_APPLY',
  /** Money owed back to us — a paid-for shortage (§8.2). Module 3. */
  RECEIVABLE: 'RECEIVABLE',
  RECEIVABLE_CLOSE: 'RECEIVABLE_CLOSE',
  WRITEOFF: 'WRITEOFF',
} as const;

export type SupplierEntryType =
  (typeof SupplierEntry)[keyof typeof SupplierEntry];

/**
 * The entries that make up the *debt* stream, as distinct from advances.
 *
 * The distinction matters for the exchange rate: an advance is money we have
 * already spent at a known cost, while debt carries the rate it was recognised
 * at (§10.1) until it is paid. Mixing them would corrupt the average rate that
 * §10.2's gain/loss is measured against.
 */
export const SUPPLIER_DEBT_ENTRIES: readonly string[] = [
  SupplierEntry.PAYABLE,
  SupplierEntry.PAYMENT,
  SupplierEntry.PREPAYMENT_APPLY,
];

/**
 * The advance stream, as distinct from debt.
 *
 * An advance is money already spent at a known cost; it is drawn down by
 * PREPAYMENT_APPLY when a Receipt puts it against a payable (§4.3). Keeping
 * it separate from the debt stream is what lets a supplier owe us an advance
 * and be owed a payable at the same time without the two cancelling into a
 * single meaningless number.
 */
export const SUPPLIER_PREPAY_ENTRIES: readonly string[] = [
  SupplierEntry.PREPAYMENT,
  SupplierEntry.PREPAYMENT_APPLY,
];

/** Cargo ledger (§5.2). Same convention, in USD. */
export const CargoEntry = {
  /** Cargo cost recognised at Receipt (§5.2). Module 3. Negative. */
  PAYABLE: 'PAYABLE',
  /** A CPY. Positive; may leave the balance positive — a deposit. */
  PAYMENT: 'PAYMENT',
  RECEIVABLE: 'RECEIVABLE',
  WRITEOFF: 'WRITEOFF',
} as const;

export type CargoEntryType = (typeof CargoEntry)[keyof typeof CargoEntry];

export const CARGO_DEBT_ENTRIES: readonly string[] = [
  CargoEntry.PAYABLE,
  CargoEntry.PAYMENT,
];
