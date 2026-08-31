import { Prisma, expense_alloc_basis } from '@prisma/client';
import { ReceiptFull } from './receipts.repository';

const ZERO = new Prisma.Decimal(0);

/** One reason the receipt cannot be confirmed, said plainly enough to fix. */
export interface ReceiptProblem {
  /** Machine-readable, so the UI can point at the right field. */
  code: string;
  /** Which product it is about, when it is about one. */
  product_id?: string;
  sku?: string;
  /** Which expense it is about, when it is about one. */
  expense_id?: string;
  /** The field the person has to fill in. */
  field?: string;
  message: string;
}

/**
 * Everything §7 and §9.8 say must be true before goods become stock.
 *
 * These are not warnings. A receipt that passes here fixes a landed cost that
 * every later sale, margin and bonus is measured against, so a missing weight
 * or an unbalanced manual split has to stop the document rather than be
 * guessed around.
 *
 * Every problem names the product and the field, because "data incomplete" is
 * not something a person at the warehouse door can act on.
 */
export function validateReceipt(receipt: ReceiptFull): ReceiptProblem[] {
  const problems: ReceiptProblem[] = [];

  if (receipt.receipt_items.length === 0) {
    problems.push({
      code: 'NO_LINES',
      message: 'Приходдо бир да позиция жок (§7)',
    });
    return problems;
  }

  const received = receipt.receipt_items.filter((item) =>
    item.received_qty.greaterThan(0),
  );

  if (received.length === 0) {
    problems.push({
      code: 'NOTHING_RECEIVED',
      message:
        'Бир да товар кабыл алынган жок: приход кылууга эч нерсе жок (§8.1)',
    });
  }

  // §9.1: physical weight is mandatory for every SKU in the batch, whatever
  // basis the expenses use — it is also what FIFO and logistics analysis read
  // later.
  for (const item of received) {
    if (item.products.weight_kg === null) {
      problems.push({
        code: 'MISSING_WEIGHT',
        product_id: item.product_id,
        sku: item.products.sku,
        field: 'products.weight_kg',
        message: `«${item.products.name}» (${item.products.sku}) товарында физикалык салмак жок — салмагы жок SKU менен приход тастыкталбайт (§9.1)`,
      });
    } else if (item.products.weight_kg.lessThanOrEqualTo(0)) {
      problems.push({
        code: 'MISSING_WEIGHT',
        product_id: item.product_id,
        sku: item.products.sku,
        field: 'products.weight_kg',
        message: `«${item.products.name}» (${item.products.sku}) салмагы нөл — приход тастыкталбайт (§9.1)`,
      });
    }

    if (item.damaged_qty.greaterThan(item.received_qty)) {
      problems.push({
        code: 'DAMAGED_EXCEEDS_RECEIVED',
        product_id: item.product_id,
        sku: item.products.sku,
        field: 'damaged_qty',
        message: `«${item.products.sku}»: брак саны кабыл алынгандан көп боло албайт`,
      });
    }
  }

  if (receipt.rate_cny === null) {
    problems.push({
      code: 'MISSING_RATE',
      field: 'rate_cny',
      message: 'Товардын CNY/KGS курсу коюла элек (§10.1)',
    });
  }
  if (receipt.rate_cny !== null && receipt.rate_cny_source === null) {
    problems.push({
      code: 'MISSING_RATE_SOURCE',
      field: 'rate_cny_source',
      message: 'CNY курсунун булагы жазыла элек (ФАКТИЧЕСКИЙ/REFERENCE/MANUAL) (§10.1)',
    });
  }

  for (const expense of receipt.receipt_expenses) {
    const label = `${expense.etype} (${expense.amount.toFixed(2)} ${expense.currency})`;

    // §10.1: every rate used, and its source, is stored on the document.
    if (expense.currency !== 'KGS') {
      if (expense.rate === null || expense.rate.lessThanOrEqualTo(0)) {
        problems.push({
          code: 'MISSING_EXPENSE_RATE',
          expense_id: expense.id,
          field: 'rate',
          message: `${label} чыгымынын курсу жок (§10.1)`,
        });
      }
      if (expense.rate_source === null) {
        problems.push({
          code: 'MISSING_EXPENSE_RATE_SOURCE',
          expense_id: expense.id,
          field: 'rate_source',
          message: `${label} чыгымынын курсунун булагы жок (§10.1)`,
        });
      }
    }

    if (expense.alloc_basis === expense_alloc_basis.VOLUME) {
      // §9.4: VOLUME needs volume or chargeable weight on every line it
      // touches, and §9.8 blocks the receipt when it is missing.
      for (const item of received) {
        const volume =
          item.products.chargeable_weight_kg ?? item.products.volume_m3;
        if (volume === null || volume.lessThanOrEqualTo(0)) {
          problems.push({
            code: 'MISSING_VOLUME',
            product_id: item.product_id,
            sku: item.products.sku,
            expense_id: expense.id,
            field: 'products.chargeable_weight_kg',
            message:
              `${label} чыгымы VOLUME менен бөлүштүрүлөт, бирок ` +
              `«${item.products.name}» (${item.products.sku}) товарында көлөм/chargeable weight жок (§9.4)`,
          });
        }
      }
    }

    if (expense.alloc_basis === expense_alloc_basis.VALUE) {
      for (const item of received) {
        const priceLine = receipt.purchases.purchase_items.find(
          (line) => line.product_id === item.product_id,
        );
        if (!priceLine || priceLine.price_cny.lessThanOrEqualTo(0)) {
          problems.push({
            code: 'MISSING_VALUE',
            product_id: item.product_id,
            sku: item.products.sku,
            expense_id: expense.id,
            field: 'purchase_items.price_cny',
            message:
              `${label} чыгымы VALUE менен бөлүштүрүлөт, бирок ` +
              `«${item.products.sku}» товарынын сатып алуу наркы жок (§9.5)`,
          });
        }
      }
    }

    if (expense.alloc_basis === expense_alloc_basis.MANUAL) {
      const manual = new Map(
        expense.receipt_expense_manual_allocations.map((row) => [
          row.receipt_item_id,
          row.amount_kgs,
        ]),
      );

      let total = ZERO;
      for (const item of received) {
        const amount = manual.get(item.id);
        if (amount === undefined) {
          problems.push({
            code: 'MANUAL_MISSING_LINE',
            product_id: item.product_id,
            sku: item.products.sku,
            expense_id: expense.id,
            field: 'manual_allocations',
            message: `${label}: «${item.products.sku}» позициясына кол менен сумма коюла элек (§9.6)`,
          });
        } else {
          total = total.plus(amount);
        }
      }

      if (!total.equals(expense.kgs_amount)) {
        problems.push({
          code: 'MANUAL_SUM_MISMATCH',
          expense_id: expense.id,
          field: 'manual_allocations',
          message:
            `${label}: кол менен бөлүштүрүлгөн ${total.toFixed(2)} KGS, ` +
            `чыгым ${expense.kgs_amount.toFixed(2)} KGS — тыйынга чейин тең болушу керек (§9.6, §9.9)`,
        });
      }
    }
  }

  return problems;
}
