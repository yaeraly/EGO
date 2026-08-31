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

  /** Days before a debt falls due to warn the salesperson and OWNER (§16). */
  DEBT_DUE_WARNING_DAYS: 'debt.due_warning_days',
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
    key: SettingKey.DEBT_DUE_WARNING_DAYS,
    value: 3,
    description:
      'Days before a debt falls due to warn the salesperson and the OWNER (§16: "мөөнөтүнө 3 күн калганда").',
  },
];
