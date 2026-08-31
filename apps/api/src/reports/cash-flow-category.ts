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
  // §38.7 — scrap money is cash the business earned, not equity and not a
  // move between its own accounts.
  [doc_type.OIN]: CashFlowCategory.OPERATING,
  // §26 — rent, internet, stationery. Batch freight is not here: §9 puts it
  // into the landed cost, where it belongs.
  [doc_type.EXP]: CashFlowCategory.OPERATING,
  // §25 — a salary is an operating expense. §3.1.6 keeps it apart from an
  // owner's withdrawal, which is why the two never share a document type.
  [doc_type.SLR]: CashFlowCategory.OPERATING,
  [doc_type.CEX]: CashFlowCategory.INTERNAL_TRANSFER,
};

export function cashFlowCategory(docType: doc_type): CashFlowCategory | null {
  return CATEGORIES[docType] ?? null;
}

/** True for the equity movements §3.1.6 forbids booking as expenses. */
export function isCapitalFinancing(docType: doc_type): boolean {
  return cashFlowCategory(docType) === CashFlowCategory.CAPITAL_FINANCING;
}
