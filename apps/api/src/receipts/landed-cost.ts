import { Prisma, expense_alloc_basis } from '@prisma/client';
import {
  AllocationError,
  AllocationTarget,
  allocateExpense,
} from '../allocation/allocation';

const ZERO = new Prisma.Decimal(0);

/** One receipt line, as the costing sees it. */
export interface CostingLine {
  /** receipt_item id — also the allocation target id. */
  id: string;
  productId: string;
  sku: string;
  name: string;
  orderedQty: Prisma.Decimal;
  /** Physically accepted, damaged units included (§8.1, §8.4). */
  receivedQty: Prisma.Decimal;
  damagedQty: Prisma.Decimal;
  unitWeightKg: Prisma.Decimal | null;
  /** Volumetric or chargeable weight per unit, when known (§9.4). */
  unitVolume: Prisma.Decimal | null;
  /** Supplier price per unit, in CNY. */
  priceCny: Prisma.Decimal;
}

export interface CostingExpense {
  id: string;
  etype: string;
  amountKgs: Prisma.Decimal;
  basis: expense_alloc_basis;
  /** MANUAL only: what the OWNER typed, per receipt line (§9.6). */
  manualByLine?: Map<string, Prisma.Decimal>;
}

export interface CostedLine {
  lineId: string;
  productId: string;
  sku: string;
  name: string;
  orderedQty: Prisma.Decimal;
  receivedQty: Prisma.Decimal;
  damagedQty: Prisma.Decimal;
  unitWeightKg: Prisma.Decimal;
  totalWeightKg: Prisma.Decimal;
  /** Received quantity × price, in CNY. */
  purchaseCostCny: Prisma.Decimal;
  /** The same at the receipt's rate — the "Purchase Cost" of §9.7. */
  purchaseCostKgs: Prisma.Decimal;
  /** What each expense put on this line, for the audit trail (§9.6). */
  allocatedByExpense: Map<string, Prisma.Decimal>;
  allocatedTotalKgs: Prisma.Decimal;
  /** Purchase Cost + Allocated (§9.7). */
  totalLandedCostKgs: Prisma.Decimal;
  /** Total ÷ received qty (§9.7). Zero when nothing was received. */
  unitLandedCost: Prisma.Decimal;
}

export interface CostingResult {
  lines: CostedLine[];
  totalWeightKg: Prisma.Decimal;
  totalLandedCostKgs: Prisma.Decimal;
}

/**
 * Turns a receipt into per-unit landed costs (§9.7).
 *
 * Pure, like the allocator it builds on: this decides the number that becomes
 * every FIFO layer's cost, and through it every COGS, margin and bonus figure
 * the business ever reports. It has to be checkable on its own.
 *
 * Two rules from §8.1 and §8.6 shape it:
 *
 *   - only what actually arrived is costed. Money paid for goods that never
 *     came does not inflate what did come — that becomes a receivable or
 *     reduces the payable (§8.2–8.3), never a cost;
 *   - a line that received nothing carries no expense at all, so a lost
 *     shipment does not silently reload its freight onto its neighbours
 *     (§8.6). What the lost goods cost is a claim, not a cost.
 */
export function computeLandedCost(params: {
  lines: CostingLine[];
  expenses: CostingExpense[];
  /** KGS per CNY for the goods themselves (§10.1). */
  rateCny: Prisma.Decimal;
}): CostingResult {
  // §8.1 and §8.6: allocation targets only the goods that arrived.
  const received = params.lines.filter((line) =>
    line.receivedQty.greaterThan(0),
  );

  const byLine = new Map<string, CostedLine>();
  for (const line of params.lines) {
    const unitWeight = line.unitWeightKg ?? ZERO;
    const purchaseCostCny = line.receivedQty.times(line.priceCny);
    byLine.set(line.id, {
      lineId: line.id,
      productId: line.productId,
      sku: line.sku,
      name: line.name,
      orderedQty: line.orderedQty,
      receivedQty: line.receivedQty,
      damagedQty: line.damagedQty,
      unitWeightKg: unitWeight,
      totalWeightKg: unitWeight.times(line.receivedQty),
      purchaseCostCny,
      purchaseCostKgs: purchaseCostCny
        .times(params.rateCny)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      allocatedByExpense: new Map(),
      allocatedTotalKgs: ZERO,
      totalLandedCostKgs: ZERO,
      unitLandedCost: ZERO,
    });
  }

  if (received.length > 0) {
    const targets: AllocationTarget[] = received.map((line) => {
      const costed = byLine.get(line.id)!;
      return {
        id: line.id,
        weight: costed.totalWeightKg,
        volume:
          line.unitVolume === null
            ? null
            : line.unitVolume.times(line.receivedQty),
        value: costed.purchaseCostKgs,
      };
    });

    for (const expense of params.expenses) {
      const withManual: AllocationTarget[] =
        expense.basis === expense_alloc_basis.MANUAL
          ? targets.map((target) => ({
              ...target,
              manualAmount: expense.manualByLine?.get(target.id),
            }))
          : targets;

      const split = allocateExpense(
        { amountKgs: expense.amountKgs, basis: expense.basis },
        withManual,
      );

      for (const [lineId, amount] of split) {
        const costed = byLine.get(lineId)!;
        costed.allocatedByExpense.set(expense.id, amount);
        costed.allocatedTotalKgs = costed.allocatedTotalKgs.plus(amount);
      }
    }
  } else if (params.expenses.some((e) => e.amountKgs.greaterThan(0))) {
    // Nothing arrived, so there is nothing to carry the freight. §8.6 says
    // such costs are claimed from whoever lost the goods, not absorbed.
    throw new AllocationError(
      'Nothing was received, so no expense can be allocated; the freight on lost goods is a claim (§8.6, §8.5)',
    );
  }

  let totalWeight = ZERO;
  let totalLanded = ZERO;

  for (const costed of byLine.values()) {
    costed.totalLandedCostKgs = costed.purchaseCostKgs.plus(
      costed.allocatedTotalKgs,
    );
    costed.unitLandedCost = costed.receivedQty.greaterThan(0)
      ? costed.totalLandedCostKgs
          .dividedBy(costed.receivedQty)
          .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
      : ZERO;

    totalWeight = totalWeight.plus(costed.totalWeightKg);
    totalLanded = totalLanded.plus(costed.totalLandedCostKgs);
  }

  return {
    lines: [...byLine.values()],
    totalWeightKg: totalWeight.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP),
    totalLandedCostKgs: totalLanded,
  };
}

/** One costed line as the API sends it: fixed scale, decimal strings. */
export interface CostedLineView {
  line_id: string;
  product_id: string;
  sku: string;
  name: string;
  ordered_qty: string;
  received_qty: string;
  damaged_qty: string;
  unit_weight_kg: string;
  total_weight_kg: string;
  purchase_cost_cny: string;
  purchase_cost_kgs: string;
  allocated: { expense_id: string; amount_kgs: string }[];
  allocated_total_kgs: string;
  total_landed_cost_kgs: string;
  unit_landed_cost: string;
}

export interface CostingView {
  lines: CostedLineView[];
  total_weight_kg: string;
  total_landed_cost_kgs: string;
}

/**
 * Renders a costing at its stored scales.
 *
 * A Decimal serialises as the shortest string that represents it, so
 * 6 546.6670 would arrive as "6546.667" and sit beside "13233.3325" on the
 * same screen looking like a different kind of number. Unit cost is
 * NUMERIC(14,4), money is (14,2) and weight is (12,3) — the scales the
 * columns hold, applied once, here.
 */
export function toCostingView(result: CostingResult): CostingView {
  return {
    lines: result.lines.map((line) => ({
      line_id: line.lineId,
      product_id: line.productId,
      sku: line.sku,
      name: line.name,
      ordered_qty: line.orderedQty.toFixed(2),
      received_qty: line.receivedQty.toFixed(2),
      damaged_qty: line.damagedQty.toFixed(2),
      unit_weight_kg: line.unitWeightKg.toFixed(3),
      total_weight_kg: line.totalWeightKg.toFixed(3),
      purchase_cost_cny: line.purchaseCostCny.toFixed(2),
      purchase_cost_kgs: line.purchaseCostKgs.toFixed(2),
      allocated: [...line.allocatedByExpense].map(([expenseId, amount]) => ({
        expense_id: expenseId,
        amount_kgs: amount.toFixed(2),
      })),
      allocated_total_kgs: line.allocatedTotalKgs.toFixed(2),
      total_landed_cost_kgs: line.totalLandedCostKgs.toFixed(2),
      unit_landed_cost: line.unitLandedCost.toFixed(4),
    })),
    total_weight_kg: result.totalWeightKg.toFixed(3),
    total_landed_cost_kgs: result.totalLandedCostKgs.toFixed(2),
  };
}
