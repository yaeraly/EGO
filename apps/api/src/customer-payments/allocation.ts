import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);

/** One open debt a payment can be put against. */
export interface AllocatableDebt {
  saleId: string;
  docNumber: string;
  outstanding: Prisma.Decimal;
}

export interface AllocationLine {
  saleId: string;
  amount: Prisma.Decimal;
  isManual: boolean;
}

export interface AllocationOutcome {
  lines: AllocationLine[];
  /** Money left after every open debt is closed — an advance (§16-А.5). */
  overpayment: Prisma.Decimal;
}

export class AllocationError extends Error {}

/**
 * Puts a payment against a customer's open debts (§16-А).
 *
 * The default is oldest-first (§16-А.1): the debts arrive already ordered by
 * business date, and the payment fills them in turn. A cashier who names
 * particular sales overrides that for those sales, and whatever is left over
 * still falls to the oldest of the rest — §16-А.2 lets the cashier direct a
 * payment, not abandon the ones they did not name.
 *
 * Anything beyond every open debt is the overpayment §16-А.5 turns into an
 * advance. It is returned rather than silently absorbed, because the cashier
 * has to tell the customer about it.
 *
 * Pure: this decides which debts are closed, and is worth checking on its own.
 */
export function allocatePayment(params: {
  amount: Prisma.Decimal;
  /** Open debts, oldest first. */
  debts: AllocatableDebt[];
  /** Sales the cashier named, with the amount for each (§16-А.2). */
  manual?: { saleId: string; amount: Prisma.Decimal }[];
}): AllocationOutcome {
  if (params.amount.lessThanOrEqualTo(0)) {
    throw new AllocationError('A payment must be greater than zero');
  }

  const remaining = new Map(
    params.debts.map((debt) => [debt.saleId, debt.outstanding]),
  );
  const lines: AllocationLine[] = [];
  let left = params.amount;

  for (const entry of params.manual ?? []) {
    const open = remaining.get(entry.saleId);
    if (open === undefined) {
      throw new AllocationError(
        `Sale ${entry.saleId} has no open debt for this customer`,
      );
    }
    if (entry.amount.lessThanOrEqualTo(0)) {
      throw new AllocationError('A manual allocation must be greater than zero');
    }
    if (entry.amount.greaterThan(open)) {
      throw new AllocationError(
        `Sale ${entry.saleId} owes ${open.toFixed(2)}; ${entry.amount.toFixed(2)} cannot be put against it`,
      );
    }
    if (entry.amount.greaterThan(left)) {
      throw new AllocationError(
        `The named allocations come to more than the payment (${params.amount.toFixed(2)})`,
      );
    }

    lines.push({ saleId: entry.saleId, amount: entry.amount, isManual: true });
    remaining.set(entry.saleId, open.minus(entry.amount));
    left = left.minus(entry.amount);
  }

  // §16-А.1 — whatever is left goes to the oldest debts still open.
  for (const debt of params.debts) {
    if (left.lessThanOrEqualTo(0)) {
      break;
    }
    const open = remaining.get(debt.saleId) ?? ZERO;
    if (open.lessThanOrEqualTo(0)) {
      continue;
    }

    const take = Prisma.Decimal.min(left, open);
    const existing = lines.find(
      (line) => line.saleId === debt.saleId && !line.isManual,
    );
    if (existing) {
      existing.amount = existing.amount.plus(take);
    } else {
      lines.push({ saleId: debt.saleId, amount: take, isManual: false });
    }
    remaining.set(debt.saleId, open.minus(take));
    left = left.minus(take);
  }

  return { lines, overpayment: left };
}
