import { doc_type } from '@prisma/client';

/**
 * Cash Flow classification (§3.1.5, §28).
 *
 * The Cash Flow statement separates operating from capital/financing flows,
 * and the separation is the whole point of §3.1: an owner drawing money out
 * is real cash leaving the business, but it is not an operating expense and
 * must never appear as one.
 */
export enum CashFlowCategory {
  /** Day-to-day trading: sales, customer payments, expenses, salaries. */
  OPERATING = 'OPERATING',
  /** Owner and investor equity movements — never P&L expenses (§3.1.6). */
  CAPITAL_FINANCING = 'CAPITAL_FINANCING',
  /** Money moving between the company's own accounts; total cash unchanged. */
  INTERNAL_TRANSFER = 'INTERNAL_TRANSFER',
  /**
   * Buying or selling something the business keeps rather than trades.
   *
   * §28 asks the statement to separate this flow. Nothing in the system
   * produces one yet — goods bought for resale are operating, not investing —
   * so the section exists and reads zero until there is a document for it.
   */
  INVESTING = 'INVESTING',
}

/**
 * Only the document types that move cash and exist today are classified.
 * A type gets its category when its module lands, rather than being guessed
 * here — a wrong classification would silently misstate the Cash Flow
 * statement.
 */
const CATEGORIES: Partial<Record<doc_type, CashFlowCategory>> = {
  [doc_type.CAP]: CashFlowCategory.CAPITAL_FINANCING,
  [doc_type.WDW]: CashFlowCategory.CAPITAL_FINANCING,
  [doc_type.TRN]: CashFlowCategory.INTERNAL_TRANSFER,
  // Trading, all of it: the goods sold, the money the customer pays for
  // them, what is refunded, and what is paid to the supplier and the
  // carrier who brought them (§13, §16-А, §35, §4, §5.2).
  [doc_type.SAL]: CashFlowCategory.OPERATING,
  [doc_type.LSS]: CashFlowCategory.OPERATING,
  [doc_type.PAY]: CashFlowCategory.OPERATING,
  [doc_type.RET]: CashFlowCategory.OPERATING,
  // An advance is customers' money held against goods not yet given
  // (§17-А), so it is cash the business really has and really may owe back.
  [doc_type.ADV]: CashFlowCategory.OPERATING,
  [doc_type.SPY]: CashFlowCategory.OPERATING,
  [doc_type.CPY]: CashFlowCategory.OPERATING,
  // §38.7 — scrap money is cash the business earned, not equity and not a
  // move between its own accounts.
  [doc_type.OIN]: CashFlowCategory.OPERATING,
  // §26 — rent, internet, stationery. Batch freight is not here: §9 puts it
  // into the landed cost, where it belongs.
  [doc_type.EXP]: CashFlowCategory.OPERATING,
  // §25 — a salary is an operating expense. §3.1.6 keeps it apart from an
  // owner's withdrawal, which is why the two never share a document type.
  [doc_type.SLR]: CashFlowCategory.OPERATING,
  // §23 — a bonus is pay, and pay is operating.
  [doc_type.BON]: CashFlowCategory.OPERATING,
  [doc_type.CEX]: CashFlowCategory.INTERNAL_TRANSFER,
  // COR is deliberately absent: a correction has no category of its own. It
  // takes the category of the document it reverses — putting an expense back
  // is an operating inflow, undoing a capital injection is a financing
  // outflow. `correctionCashFlowCategory` is how that is asked.
};

export function cashFlowCategory(docType: doc_type): CashFlowCategory | null {
  return CATEGORIES[docType] ?? null;
}

/**
 * Where a Correction/Reversal belongs in the Cash Flow (§27.1, §28).
 *
 * The same place as the document it reverses, with the opposite sign — which
 * the movements already carry. Classifying COR as one fixed category would
 * misstate the statement every time it corrected a different kind of
 * document.
 */
export function correctionCashFlowCategory(
  originalDocType: doc_type,
): CashFlowCategory | null {
  return cashFlowCategory(originalDocType);
}

/** True for the equity movements §3.1.6 forbids booking as expenses. */
export function isCapitalFinancing(docType: doc_type): boolean {
  return cashFlowCategory(docType) === CashFlowCategory.CAPITAL_FINANCING;
}
