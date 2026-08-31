import { Prisma, customer_category } from '@prisma/client';

/** One category and the turnover it starts at, in KGS. */
export interface CategoryThreshold {
  category: customer_category;
  from: Prisma.Decimal;
}

/**
 * Picks the category a turnover earns (§12).
 *
 * Thresholds are configured, not hard-coded: §12 gives Standard 0–49 999 and
 * Silver 50 000–99 999 and marks Gold and VIP "кийин такталат". An
 * unconfigured threshold is simply absent from `thresholds`, so the customer
 * lands in the highest band that *is* configured — never in a guessed one.
 *
 * Pure, and separate from the job that calls it, so the boundaries are
 * testable without a database.
 */
export function categoryFor(
  turnover: Prisma.Decimal,
  thresholds: CategoryThreshold[],
): customer_category {
  const ordered = [...thresholds].sort((a, b) => a.from.comparedTo(b.from));

  let earned: customer_category = customer_category.STANDARD;
  for (const threshold of ordered) {
    if (turnover.greaterThanOrEqualTo(threshold.from)) {
      earned = threshold.category;
    }
  }
  return earned;
}

/**
 * The start of the rolling window (§12.1).
 *
 * `months` back from today, to the day — a customer who spent 60 000 KGS
 * thirteen months ago is not Silver today, which is the whole point of the
 * window being rolling rather than lifetime.
 */
export function windowStart(months: number, now: Date = new Date()): Date {
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - months);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}
