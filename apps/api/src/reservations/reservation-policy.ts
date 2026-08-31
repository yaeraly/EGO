import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/** The OWNER's policy, as stored — every field may legitimately be unset. */
export interface ReservationPolicy {
  /** §17.3 — reservations at or above this need an advance. */
  advanceRequiredAboveKgs: Prisma.Decimal | null;
  /** §17.3 — the percentage the required advance is computed at. */
  minAdvancePct: Prisma.Decimal | null;
  /** §17.3 — most active reservations one customer may hold. */
  maxActivePerCustomer: number | null;
  /** §17.3 — longest a reservation with no advance may run. */
  maxNoAdvanceHours: number | null;
  /** §17.3 — used when the reservation does not state its own expiry. */
  defaultDurationHours: number | null;
}

/** What the product itself says, which can be stricter than the policy. */
export interface ProductReservationRule {
  productId: string;
  sku: string;
  /** §17.3 Product-level: an advance regardless of the amount. */
  advanceRequired: boolean;
  /** §17.3 — this product's own percentage, when it sets one. */
  minAdvancePct: Prisma.Decimal | null;
}

export interface AdvanceRequirement {
  /** What must be paid before the reservation holds stock (§17.3). */
  required: Prisma.Decimal;
  /** Why it is required at all — for the screen and the audit. */
  reason: 'NONE' | 'AMOUNT_THRESHOLD' | 'PRODUCT_RULE';
  /** The percentage used, so the figure can be explained. */
  pct: Prisma.Decimal | null;
  /** The product that forced it, when a product rule did. */
  productSku: string | null;
}

/**
 * How much advance §17.3 requires for this reservation.
 *
 * Two independent triggers: the total crossing the OWNER's threshold, and a
 * product that always demands one ("Product деңгээлинде аванс милдеттүү болсо,
 * жалпы сумма чегине карабастан"). A product rule therefore wins even on a
 * small reservation, and it brings its own percentage when it states one.
 *
 * The percentage is never guessed. §17.3 gives 20% only as an example, so a
 * requirement with no configured percentage is not silently priced at some
 * default — the caller refuses instead, which is the loud failure.
 */
export function requiredAdvance(params: {
  total: Prisma.Decimal;
  policy: ReservationPolicy;
  products: ProductReservationRule[];
}): AdvanceRequirement {
  const none: AdvanceRequirement = {
    required: ZERO,
    reason: 'NONE',
    pct: null,
    productSku: null,
  };

  const forcing = params.products.find((product) => product.advanceRequired);
  const overThreshold =
    params.policy.advanceRequiredAboveKgs !== null &&
    params.total.greaterThanOrEqualTo(params.policy.advanceRequiredAboveKgs);

  if (!forcing && !overThreshold) {
    return none;
  }

  const pct = forcing?.minAdvancePct ?? params.policy.minAdvancePct;
  if (pct === null) {
    return {
      required: ZERO,
      reason: forcing ? 'PRODUCT_RULE' : 'AMOUNT_THRESHOLD',
      pct: null,
      productSku: forcing?.sku ?? null,
    };
  }

  return {
    required: params.total
      .times(pct)
      .dividedBy(HUNDRED)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    reason: forcing ? 'PRODUCT_RULE' : 'AMOUNT_THRESHOLD',
    pct,
    productSku: forcing?.sku ?? null,
  };
}

/**
 * The latest a reservation with no advance may expire (§17.3).
 *
 * "Толук тыюу салынбайт, бирок мөөнөтү Max No-Advance Reservation Hours менен
 * чектелет" — a zero-advance reservation is allowed but time-boxed. With the
 * hours unset there is no cap to apply; the setting says so rather than this
 * inventing one.
 */
export function noAdvanceDeadline(
  from: Date,
  policy: ReservationPolicy,
): Date | null {
  if (policy.maxNoAdvanceHours === null) {
    return null;
  }
  return new Date(from.getTime() + policy.maxNoAdvanceHours * 3_600_000);
}

/** The expiry a reservation gets when it does not state one (§17.3). */
export function defaultExpiry(from: Date, policy: ReservationPolicy): Date | null {
  if (policy.defaultDurationHours === null) {
    return null;
  }
  return new Date(from.getTime() + policy.defaultDurationHours * 3_600_000);
}
