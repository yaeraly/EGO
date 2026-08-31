import { Prisma } from '@prisma/client';
import { expense_alloc_basis } from '@prisma/client';

/**
 * One position a direct expense is shared across (§9.3–9.6).
 *
 * The weights are whatever the chosen basis measures — kilograms, cubic
 * metres, or purchase value. `manualAmount` is only read for MANUAL.
 */
export interface AllocationTarget {
  /** Stable identity; also the tie-break order (§9.9 rule 5). */
  id: string;
  /** Σ physical weight for the position: unit weight × received qty (§9.3). */
  weight: Prisma.Decimal;
  /** Volumetric or chargeable weight, when the carrier bills by it (§9.4). */
  volume: Prisma.Decimal | null;
  /** Purchase value of the position, in KGS (§9.5). */
  value: Prisma.Decimal;
  /** What the OWNER typed for this position (§9.6). */
  manualAmount?: Prisma.Decimal;
}

export interface AllocationInput {
  /** The expense to share out, in KGS, at money scale. */
  amountKgs: Prisma.Decimal;
  basis: expense_alloc_basis;
}

/** What each position ends up carrying. Σ equals the source exactly (§9.9). */
export type AllocationResult = Map<string, Prisma.Decimal>;

export class AllocationError extends Error {}

const ZERO = new Prisma.Decimal(0);

/**
 * Internal precision (§9.9 step 1).
 *
 * Ratios are computed well past the money scale so the rounding in step 2 is
 * the *only* place precision is lost. Twelve places is far more than the
 * 0.01 KGS the result is rounded to, and Decimal is exact up to it.
 */
const INTERNAL_SCALE = 12;

/**
 * Shares one direct expense across the positions it belongs to (§9.3–9.9).
 *
 * Pure: same input, same output, no database and no clock. That is
 * deliberate — this function decides every product's landed cost, and through
 * it every COGS, margin and bonus figure in the system, so it has to be
 * testable on its own with the knowledge base's own examples.
 *
 * The contract §9.9 states, and this guarantees:
 *
 *     Σ result = amountKgs, exactly, at 0.01 KGS
 *
 * There is no "close enough". A remainder of one tiyin is placed on the
 * largest allocation (rule 4), and ties break on document order (rule 5), so
 * the same input always produces the same split.
 */
export function allocateExpense(
  expense: AllocationInput,
  targets: AllocationTarget[],
): AllocationResult {
  if (targets.length === 0) {
    throw new AllocationError(
      'An expense cannot be allocated: the receipt has no positions to carry it (§9.7)',
    );
  }
  if (expense.amountKgs.isNegative()) {
    throw new AllocationError('An expense amount cannot be negative');
  }

  if (expense.basis === expense_alloc_basis.MANUAL) {
    return manualAllocation(expense, targets);
  }

  const shares = targets.map((target) => ({
    id: target.id,
    share: basisShare(expense.basis, target),
  }));

  const totalShare = shares.reduce((sum, entry) => sum.plus(entry.share), ZERO);

  if (totalShare.lessThanOrEqualTo(0)) {
    throw new AllocationError(
      `Cannot allocate by ${expense.basis}: every position measures zero, so there is no proportion to divide by (§9.${basisSection(expense.basis)})`,
    );
  }

  // Step 1: the exact proportion, well past money scale.
  // Step 2: each final amount rounded to 0.01 KGS.
  const rounded = shares.map((entry) => ({
    id: entry.id,
    amount: expense.amountKgs
      .times(entry.share)
      .dividedBy(totalShare)
      .toDecimalPlaces(INTERNAL_SCALE)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
  }));

  return settleRemainder(expense.amountKgs, rounded);
}

/**
 * MANUAL (§9.6): the OWNER's own numbers, checked rather than computed.
 *
 * Nothing is redistributed here — if the figures do not add up to the
 * expense, that is a mistake to report, not a rounding to absorb. §9.9's
 * last line applies to MANUAL too, but the remainder rule exists for
 * division, and there is no division to do.
 */
function manualAllocation(
  expense: AllocationInput,
  targets: AllocationTarget[],
): AllocationResult {
  const result: AllocationResult = new Map();
  let total = ZERO;

  for (const target of targets) {
    const amount = target.manualAmount;
    if (amount === undefined) {
      throw new AllocationError(
        `MANUAL allocation is missing an amount for position ${target.id} (§9.6)`,
      );
    }
    if (amount.isNegative()) {
      throw new AllocationError(
        `MANUAL allocation for position ${target.id} cannot be negative (§9.6)`,
      );
    }
    const atScale = amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    result.set(target.id, atScale);
    total = total.plus(atScale);
  }

  if (!total.equals(expense.amountKgs)) {
    throw new AllocationError(
      `MANUAL allocation totals ${total.toFixed(2)} but the expense is ` +
        `${expense.amountKgs.toFixed(2)}; they must be equal to the tiyin (§9.6, §9.9)`,
    );
  }

  return result;
}

/**
 * §9.9 steps 3–5: put the leftover tiyin where the rule says.
 *
 * Rounding each share independently leaves the sum a tiyin or two off the
 * source. The whole difference goes onto the largest allocation, which is
 * the position least distorted by it; a tie goes to whichever came first in
 * the document, so the answer never depends on iteration order.
 */
function settleRemainder(
  source: Prisma.Decimal,
  rounded: { id: string; amount: Prisma.Decimal }[],
): AllocationResult {
  const sum = rounded.reduce((total, entry) => total.plus(entry.amount), ZERO);
  const remainder = source.minus(sum);

  if (!remainder.isZero()) {
    let largest = 0;
    for (let i = 1; i < rounded.length; i += 1) {
      if (rounded[i].amount.greaterThan(rounded[largest].amount)) {
        largest = i;
      }
    }
    rounded[largest] = {
      id: rounded[largest].id,
      amount: rounded[largest].amount.plus(remainder),
    };
  }

  const result: AllocationResult = new Map();
  for (const entry of rounded) {
    result.set(entry.id, entry.amount);
  }

  // §9.9 step 6: the guarantee this function exists to make. If it ever
  // fails, confirming the receipt must stop rather than book a wrong cost.
  const finalSum = [...result.values()].reduce((a, b) => a.plus(b), ZERO);
  if (!finalSum.equals(source)) {
    throw new AllocationError(
      `Allocation totals ${finalSum.toFixed(2)} but the expense is ${source.toFixed(2)} (§9.9)`,
    );
  }

  return result;
}

function basisShare(
  basis: expense_alloc_basis,
  target: AllocationTarget,
): Prisma.Decimal {
  switch (basis) {
    case expense_alloc_basis.WEIGHT:
      return target.weight;
    case expense_alloc_basis.VOLUME:
      if (target.volume === null) {
        throw new AllocationError(
          `Position ${target.id} has no volume or chargeable weight, which VOLUME allocation needs (§9.4)`,
        );
      }
      return target.volume;
    case expense_alloc_basis.VALUE:
      return target.value;
    default:
      throw new AllocationError(`Unknown allocation basis: ${basis}`);
  }
}

function basisSection(basis: expense_alloc_basis): string {
  return basis === expense_alloc_basis.WEIGHT
    ? '3'
    : basis === expense_alloc_basis.VOLUME
      ? '4'
      : '5';
}
