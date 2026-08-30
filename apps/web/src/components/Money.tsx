import type { CurrencyCode } from '../api/types';

/**
 * Shows an amount exactly as the API sent it.
 *
 * The value is a decimal string and stays one: `Number(value)` would round
 * it, and money is NUMERIC/Decimal everywhere else in the system. Grouping is
 * applied to the digits themselves, so nothing is reinterpreted.
 */
export function Money({
  value,
  currency,
  className = '',
}: {
  value: string;
  currency?: CurrencyCode | string;
  className?: string;
}) {
  const negative = value.trim().startsWith('-');
  return (
    <span className={`money ${negative ? 'negative' : ''} ${className}`.trim()}>
      {group(value)}
      {currency ? ` ${currency}` : ''}
    </span>
  );
}

/**
 * A narrow no-break space (U+202F) between digit groups.
 *
 * No-break so an amount never wraps across two lines on a phone, and narrow
 * so "1 000.00" still reads as one number rather than two.
 */
export const GROUP_SEPARATOR = '\u202f';

/** Groups the digits every three places. The digits themselves never change. */
export function group(value: string): string {
  const [sign, digits] = value.startsWith('-')
    ? ['-', value.slice(1)]
    : ['', value];
  const [whole, fraction] = digits.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
  return `${sign}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

/** True when a decimal string is strictly negative. */
export function isNegative(value: string): boolean {
  return /^-(?!0+(\.0+)?$)/.test(value.trim());
}
