/**
 * Settings the system reads by name.
 *
 * A key is seeded so it is discoverable and documented; its *value* is the
 * OWNER's to set. The PIN threshold (50000, Security section) and the SILVER
 * threshold (50000, §12) have values the knowledge base states. The GOLD and
 * VIP thresholds are marked "кийин такталат" there, and §23 gives no default
 * bonus rate, so those three are seeded unconfigured on purpose — a guessed
 * threshold or rate would quietly misprice customers and mispay staff, which
 * is worse than a loud failure.
 */
export const SettingKey = {
  /** A sale at or above this KGS amount requires a PIN confirmation. */
  SALE_PIN_THRESHOLD_KGS: 'sale.pin_required_threshold_kgs',

  /** Turnover at which a customer reaches each category (§12). */
  CATEGORY_SILVER_THRESHOLD_KGS: 'customer.category.silver.threshold_kgs',
  CATEGORY_GOLD_THRESHOLD_KGS: 'customer.category.gold.threshold_kgs',
  CATEGORY_VIP_THRESHOLD_KGS: 'customer.category.vip.threshold_kgs',

  /** Bonus rate applied when a user has none of their own (§23). */
  BONUS_DEFAULT_RATE_PCT: 'bonus.default_rate_pct',

  /**
   * Manual reference rates, used only until the system has bought that
   * currency for the first time (§10.1: "Эгер система иштегенден бери валюта
   * сатып алуу боло элек болсо, OWNER кол менен reference rate киргизет жана
   * бул аудитте сакталат"). Once a CEX exists its rate wins, so these are a
   * cold-start fallback rather than an override.
   */
  MANUAL_REFERENCE_RATE_CNY: 'fx.manual_reference_rate.cny',
  MANUAL_REFERENCE_RATE_USD: 'fx.manual_reference_rate.usd',

  /** Warn when a currency till falls below this, in that currency (§39). */
  LOW_BALANCE_THRESHOLD_CNY: 'alerts.low_balance_threshold.cny',
  LOW_BALANCE_THRESHOLD_USD: 'alerts.low_balance_threshold.usd',

  /** Rolling window the category calculation looks back over (§12.1). */
  CATEGORY_WINDOW_MONTHS: 'customer.category.window_months',

  /**
   * Extra markup per customer type and category (§13), in percent.
   *
   * The second of the two pricing levels: the product carries its own base
   * markup, and this adds what the customer's standing is worth. §13's own
   * example — a wholesale VIP paying no extra at all — is why this is a
   * matrix rather than a single number.
   */
  PRICING_MARKUP_MATRIX: 'pricing.markup_matrix_pct',

  /** Default credit limit per category, when the customer has none (§16.1). */
  CREDIT_LIMIT_DEFAULTS: 'credit.category_default_limit_kgs',

  /**
   * Whether a salesperson sees the COGS figure on the sale screen.
   *
   * §13.4 blocks a below-cost sale for everyone; what it does not require is
   * showing the cost itself to whoever is at the counter. Off by default —
   * the block's message says what is wrong without disclosing margins.
   */
  SHOW_COGS_TO_STAFF: 'sale.show_cogs_to_staff',


  /**
   * Reservation policy (§17.3).
   *
   * §17.3 names each of these but states no numbers — its 20 000 / 20% is
   * introduced as "Мисалы". They are seeded unconfigured, and each has a
   * defined meaning when unset, described on the seed entry: an unset limit
   * does not silently become a guessed one.
   */
  RESERVATION_ADVANCE_REQUIRED_ABOVE_KGS: 'reservation.advance_required_above_kgs',
  RESERVATION_MIN_ADVANCE_PCT: 'reservation.minimum_advance_pct',
  RESERVATION_MAX_ACTIVE_PER_CUSTOMER: 'reservation.max_active_per_customer',
  RESERVATION_MAX_NO_ADVANCE_HOURS: 'reservation.max_no_advance_hours',
  RESERVATION_DEFAULT_DURATION_HOURS: 'reservation.default_duration_hours',

  /**
   * Cancellation fee, in percent of the advance (§17.2).
   *
   * §17.2 makes the default rule a full refund and says the fee is off in the
   * MVP while the architecture stands ready for it. Unset means exactly that:
   * a cancelled reservation refunds the advance in full.
   */
  RESERVATION_CANCELLATION_FEE_PCT: 'reservation.cancellation_fee_pct',


  /**
   * Inventory and warehouse handover (§21, §22).
   *
   * §22 puts the full-count schedule in the OWNER's settings and asks for at
   * least one a month; §21.1 leaves the A-class list to the OWNER, and the
   * categories of Module 5 are how that list is expressed here.
   */
  INVENTORY_FULL_COUNT_EVERY_DAYS: 'inventory.full_count_every_days',
  HANDOVER_A_CLASS_CATEGORIES: 'handover.a_class_category_ids',
  HANDOVER_RANDOM_POSITIONS: 'handover.random_positions',

  /** Days before a debt falls due to warn the salesperson and OWNER (§16). */
  DEBT_DUE_WARNING_DAYS: 'debt.due_warning_days',

  /**
   * Where the ABC and XYZ classes divide (§29).
   *
   * §29 asks for both analyses and states no cut-offs. These are the
   * conventional ones — 80/95 of cumulative revenue, and a coefficient of
   * variation of 10%/25% — seeded so the report works out of the box and
   * shown on the screen so nobody mistakes them for a rule of this business.
   */
  ABC_A_THRESHOLD_PCT: 'analytics.abc.a_threshold_pct',
  ABC_B_THRESHOLD_PCT: 'analytics.abc.b_threshold_pct',
  XYZ_X_THRESHOLD_PCT: 'analytics.xyz.x_threshold_pct',
  XYZ_Y_THRESHOLD_PCT: 'analytics.xyz.y_threshold_pct',
} as const;

export type SettingKeyName = (typeof SettingKey)[keyof typeof SettingKey];

export interface SeededSetting {
  key: string;
  /** null means "the OWNER must set this before the feature works". */
  value: unknown;
  description: string;
}

export const SEEDED_SETTINGS: SeededSetting[] = [
  {
    key: SettingKey.SALE_PIN_THRESHOLD_KGS,
    value: 50000,
    description:
      'Sales at or above this KGS amount require a PIN confirmation. Specified value: 50000.',
  },
  {
    key: SettingKey.CATEGORY_SILVER_THRESHOLD_KGS,
    value: 50000,
    description:
      'Turnover in KGS at which a customer becomes SILVER (§12: Standard 0-49 999, Silver 50 000-99 999).',
  },
  {
    key: SettingKey.CATEGORY_GOLD_THRESHOLD_KGS,
    value: null,
    description:
      'Turnover in KGS at which a customer becomes GOLD (§12). UNCONFIGURED — the knowledge base states "кийин такталат".',
  },
  {
    key: SettingKey.CATEGORY_VIP_THRESHOLD_KGS,
    value: null,
    description:
      'Turnover in KGS at which a customer becomes VIP (§12). UNCONFIGURED — the knowledge base states "кийин такталат".',
  },
  {
    key: SettingKey.BONUS_DEFAULT_RATE_PCT,
    value: null,
    description:
      'Bonus rate in percent for users with no individual rate (§23). UNCONFIGURED — set before bonuses are calculated.',
  },
  {
    key: SettingKey.MANUAL_REFERENCE_RATE_CNY,
    value: null,
    description:
      'KGS per CNY, used only until the first CEX exists (§10.1). A real currency purchase supersedes it.',
  },
  {
    key: SettingKey.MANUAL_REFERENCE_RATE_USD,
    value: null,
    description:
      'KGS per USD, used only until the first CEX exists (§10.1). A real currency purchase supersedes it.',
  },
  {
    key: SettingKey.LOW_BALANCE_THRESHOLD_CNY,
    value: null,
    description:
      'Warn when the CNY till falls below this, in CNY (§39). UNCONFIGURED — no warning is raised.',
  },
  {
    key: SettingKey.LOW_BALANCE_THRESHOLD_USD,
    value: null,
    description:
      'Warn when the USD till falls below this, in USD (§39). UNCONFIGURED — no warning is raised.',
  },
  {
    key: SettingKey.CATEGORY_WINDOW_MONTHS,
    value: 12,
    description:
      'Rolling months of turnover the category calculation reads (§12.1: "rolling акыркы 12 ай", OWNER-adjustable).',
  },
  {
    key: SettingKey.PRICING_MARKUP_MATRIX,
    value: null,
    description:
      'Extra markup percent per {type}.{category}, e.g. {"WHOLESALE":{"VIP":0}} (§13). UNCONFIGURED — the OWNER sets the percentages; until then only the product base markup applies.',
  },
  {
    key: SettingKey.CREDIT_LIMIT_DEFAULTS,
    value: null,
    description:
      'Default credit limit in KGS per category, e.g. {"STANDARD":0} (§16.1). UNCONFIGURED — a customer with no individual limit gets no credit.',
  },
  {
    key: SettingKey.SHOW_COGS_TO_STAFF,
    value: false,
    description:
      'Whether a salesperson sees the FIFO COGS on the sale screen (§13.4 blocks below-cost sales either way).',
  },
  {
    key: SettingKey.RESERVATION_ADVANCE_REQUIRED_ABOVE_KGS,
    value: null,
    description:
      'Reservations at or above this KGS amount require an advance (§17.3). UNCONFIGURED — no amount-based requirement; a product-level rule still applies.',
  },
  {
    key: SettingKey.RESERVATION_MIN_ADVANCE_PCT,
    value: null,
    description:
      'Minimum advance as a percent of the reservation amount (§17.3). UNCONFIGURED — a reservation that needs an advance is refused rather than priced at a guessed percentage.',
  },
  {
    key: SettingKey.RESERVATION_MAX_ACTIVE_PER_CUSTOMER,
    value: null,
    description:
      'Most active reservations one customer may hold (§17.3). UNCONFIGURED — no limit.',
  },
  {
    key: SettingKey.RESERVATION_MAX_NO_ADVANCE_HOURS,
    value: null,
    description:
      'Longest a reservation with no advance may run, in hours (§17.3). UNCONFIGURED — no cap; set it, because §17.3 requires such reservations to be bounded.',
  },
  {
    key: SettingKey.RESERVATION_DEFAULT_DURATION_HOURS,
    value: null,
    description:
      'Default reservation duration in hours (§17.3). UNCONFIGURED — the expiry must then be stated on each reservation.',
  },
  {
    key: SettingKey.RESERVATION_CANCELLATION_FEE_PCT,
    value: null,
    description:
      'Percent of the advance withheld on cancellation (§17.2). UNCONFIGURED — the MVP default: the advance is refunded in full.',
  },
  {
    key: SettingKey.INVENTORY_FULL_COUNT_EVERY_DAYS,
    value: 30,
    description:
      'Days between full inventories (§22: "кеминде айына 1 жолу", the schedule being the OWNER\'s). An alert is raised once a warehouse has gone longer.',
  },
  {
    key: SettingKey.HANDOVER_A_CLASS_CATEGORIES,
    value: null,
    description:
      'Category ids whose products are counted in full at every handover (§21.1: "мотор, батарея, контроллер ж.б. — тизмени OWNER аныктайт"). UNCONFIGURED — only the random sample is counted.',
  },
  {
    key: SettingKey.HANDOVER_RANDOM_POSITIONS,
    value: 12,
    description:
      'How many further positions the system picks at random for a handover (§21.1: "рандом тандалган 10–15 позиция").',
  },
  {
    key: SettingKey.DEBT_DUE_WARNING_DAYS,
    value: 3,
    description:
      'Days before a debt falls due to warn the salesperson and the OWNER (§16: "мөөнөтүнө 3 күн калганда").',
  },
  {
    key: SettingKey.ABC_A_THRESHOLD_PCT,
    value: 80,
    description:
      'Cumulative percent of revenue that makes up class A (§29). The conventional 80; §29 states no figure.',
  },
  {
    key: SettingKey.ABC_B_THRESHOLD_PCT,
    value: 95,
    description:
      'Cumulative percent of revenue where class B ends and C begins (§29). The conventional 95; §29 states no figure.',
  },
  {
    key: SettingKey.XYZ_X_THRESHOLD_PCT,
    value: 10,
    description:
      'Coefficient of variation, in percent, at or below which demand counts as steady — class X (§29). The conventional 10.',
  },
  {
    key: SettingKey.XYZ_Y_THRESHOLD_PCT,
    value: 25,
    description:
      'Coefficient of variation, in percent, at or below which demand counts as class Y; above it is Z (§29). The conventional 25.',
  },
];
