import { doc_type } from '@prisma/client';

/**
 * Which documents a correction can reverse, and why not (§27.1, Period Lock).
 *
 * §27.1 says a confirmed document is never edited: the fix is a Return (RET)
 * for a sale, and a Correction/Reversal (COR) otherwise. What a COR *does* is
 * the inverse of what the original posted — so a document can only be
 * corrected when its whole posted effect is money leaving or entering an
 * account. Those reverse exactly and leave the books where they were.
 *
 * Everything else is refused by name rather than half-reversed. A sale
 * consumed FIFO layers, a receipt created them, a currency purchase built a
 * rate layer others have since consumed — putting those back needs a rule for
 * *which* layer the goods return to, and the knowledge base states that rule
 * for a Return only (§18.0, §42.19). Until it states one for a correction,
 * refusing is the honest answer.
 */
export type Correctable = { ok: true } | { ok: false; reason: string };

/** Types whose entire posted effect is their own money movements. */
export const MONEY_ONLY: readonly doc_type[] = [
  doc_type.CAP, // capital in (§3)
  doc_type.WDW, // owner withdrawal (§3)
  doc_type.TRN, // cashier-to-cashier transfer (§19)
  doc_type.EXP, // operating expense (§26)
  doc_type.SLR, // salary (§25)
  doc_type.OIN, // scrap income (§38.7)
];

export function correctableType(docType: doc_type): Correctable {
  if (MONEY_ONLY.includes(docType)) {
    return { ok: true };
  }

  if (docType === doc_type.SAL || docType === doc_type.LSS) {
    return {
      ok: false,
      reason:
        'Сатуунун катасы возврат (RET) документи менен оңдолот (§27.1, §35). ' +
        'Сатууну COR менен жокко чыгаруу үчүн товар кайсы FIFO layerге кайтары ' +
        'билим базада жазылган эмес.',
    };
  }

  if (docType === doc_type.COR) {
    return {
      ok: false,
      reason: 'Коррекцияны коррекция менен оңдоого болбойт (§27.1).',
    };
  }

  return {
    ok: false,
    reason:
      `${docType} документинин таасири акча кыймылы менен эле чектелбейт ` +
      '(склад, FIFO layer же карыз). Мындай документти жокко чыгаруу эрежеси ' +
      'билим базада жок — адегенде ошол эреже керек (§27.1).',
  };
}
