/**
 * Alert kinds this module raises (§39).
 *
 * §39 lists thirteen alerts across the whole system; the three here are the
 * ones Module 2 can actually observe. The rest depend on modules that do not
 * exist yet (customer debt, stock minimums, Claim, reservations, inventory,
 * cash counts, plan, backup) and are deliberately not stubbed — an alert that
 * never fires is worse than one that is not there, because it reads as
 * covered.
 */
export const NotificationKind = {
  /** A supplier is owed money (§4.3, §39). */
  SUPPLIER_DEBT: 'SUPPLIER_DEBT',

  /** A cargo company is owed money (§5.2, §39). */
  CARGO_DEBT: 'CARGO_DEBT',

  /** A currency till has fallen below its configured threshold (§39). */
  LOW_CURRENCY_BALANCE: 'LOW_CURRENCY_BALANCE',

  /** A customer debt has passed its due date (§16.4, §39). */
  CUSTOMER_DEBT_OVERDUE: 'CUSTOMER_DEBT_OVERDUE',

  /** A debt falls due within the warning window (§16). */
  CUSTOMER_DEBT_DUE_SOON: 'CUSTOMER_DEBT_DUE_SOON',
} as const;

export type NotificationKindName =
  (typeof NotificationKind)[keyof typeof NotificationKind];
