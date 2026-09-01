import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

export type Severity = 'URGENT' | 'WARNING' | 'INFO';

/**
 * One thing the OWNER should do something about (§34).
 *
 * §34's whole point is the last line of it: "система жөн гана эсеп
 * жүргүзбөстөн, OWNER'ге эмне кылуу керектигин көрсөтүп турушу". So every
 * item names what to do, not merely what is true, and carries the screen
 * where it is done.
 */
export interface HealthItem {
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  link: string;
  /** The money at stake, where the item has one. */
  amount: string | null;
  currency: string | null;
  count: number;
}

const RANK: Record<Severity, number> = { URGENT: 0, WARNING: 1, INFO: 2 };

/** Most pressing first, and within a rank the largest sum first. */
export function bySeverity(a: HealthItem, b: HealthItem): number {
  const rank = RANK[a.severity] - RANK[b.severity];
  if (rank !== 0) {
    return rank;
  }
  return new Prisma.Decimal(b.amount ?? 0).comparedTo(
    new Prisma.Decimal(a.amount ?? 0),
  );
}

/**
 * How far through a month the business is, as a percentage (§34).
 *
 * A salesperson is not behind on the second of the month for having sold a
 * fifteenth of their target — they are behind when the month has run further
 * than their sales have. The comparison is against elapsed time, which is the
 * only pace a monthly plan implies.
 */
export function monthProgressPct(today: Date): Prisma.Decimal {
  const daysInMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Prisma.Decimal(today.getUTCDate())
    .times(HUNDRED)
    .dividedBy(new Prisma.Decimal(daysInMonth));
}

/**
 * Whether a salesperson is behind their plan (§34).
 *
 * Null when there is no plan, or when the month has barely started: on the
 * first morning nobody is behind, and saying so would teach the OWNER to
 * ignore the board.
 */
export function behindPlan(params: {
  achievementPct: string | null;
  monthProgressPct: Prisma.Decimal;
  /** Below this much of the month elapsed, it is too early to judge. */
  minProgressPct?: Prisma.Decimal;
}): { behind: boolean; gapPct: string } | null {
  if (params.achievementPct === null) {
    return null;
  }
  const floor = params.minProgressPct ?? new Prisma.Decimal(20);
  if (params.monthProgressPct.lessThan(floor)) {
    return null;
  }

  const achieved = new Prisma.Decimal(params.achievementPct);
  const gap = params.monthProgressPct.minus(achieved);
  return {
    behind: gap.greaterThan(ZERO),
    gapPct: gap.toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toFixed(1),
  };
}

/**
 * How loudly an open claim should ask to be chased (§8.5, §34).
 *
 * A claim is money the business is owed by someone who has already had the
 * goods or the freight; the longer it stands, the less likely it is ever
 * settled, so age alone decides.
 */
export function claimSeverity(ageDays: number, staleDays: number): Severity {
  if (ageDays >= staleDays * 2) {
    return 'URGENT';
  }
  return ageDays >= staleDays ? 'WARNING' : 'INFO';
}

/**
 * Stock that is not moving, as money standing still (§34).
 *
 * Nothing sold in the window and something on the shelf: the value is the
 * question, not the quantity — a hundred cheap clips matter less than one
 * motor nobody wants.
 */
export function deadStockSeverity(
  value: Prisma.Decimal,
  urgentAbove: Prisma.Decimal,
): Severity {
  return value.greaterThanOrEqualTo(urgentAbove) ? 'WARNING' : 'INFO';
}
