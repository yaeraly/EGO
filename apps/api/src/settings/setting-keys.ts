/**
 * Settings the system reads by name.
 *
 * A key is seeded so it is discoverable and documented; its *value* is the
 * OWNER's to set. Only the PIN threshold has a value the specification states
 * (50000). The rest are seeded unconfigured on purpose — a guessed category
 * threshold or bonus rate would quietly misprice customers and mispay staff,
 * which is worse than a loud failure.
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
    value: null,
    description:
      'Turnover in KGS at which a customer becomes SILVER (§12). UNCONFIGURED — set before customer categories are used.',
  },
  {
    key: SettingKey.CATEGORY_GOLD_THRESHOLD_KGS,
    value: null,
    description:
      'Turnover in KGS at which a customer becomes GOLD (§12). UNCONFIGURED — set before customer categories are used.',
  },
  {
    key: SettingKey.CATEGORY_VIP_THRESHOLD_KGS,
    value: null,
    description:
      'Turnover in KGS at which a customer becomes VIP (§12). UNCONFIGURED — set before customer categories are used.',
  },
  {
    key: SettingKey.BONUS_DEFAULT_RATE_PCT,
    value: null,
    description:
      'Bonus rate in percent for users with no individual rate (§23). UNCONFIGURED — set before bonuses are calculated.',
  },
];
