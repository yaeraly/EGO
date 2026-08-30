import { describe, expect, it } from 'vitest';
import { GROUP_SEPARATOR, group, isNegative } from '../src/components/Money';
import { compareDecimals } from '../src/components/TillPicker';

/**
 * The browser never does arithmetic on money — every total comes from the API
 * as a Decimal string. These two helpers are the only code that looks at the
 * digits, so they are the only place a rounding bug could enter the UI.
 */
describe('compareDecimals', () => {
  it('orders whole amounts by magnitude, not string length', () => {
    expect(compareDecimals('9.00', '10.00')).toBeLessThan(0);
    expect(compareDecimals('10.00', '9.00')).toBeGreaterThan(0);
    expect(compareDecimals('100.00', '100.00')).toBe(0);
  });

  it('compares the fraction when the whole parts match', () => {
    expect(compareDecimals('10.01', '10.02')).toBeLessThan(0);
    expect(compareDecimals('10.10', '10.09')).toBeGreaterThan(0);
    expect(compareDecimals('10.50', '10.5')).toBe(0);
  });

  it('handles differing scales', () => {
    expect(compareDecimals('10', '10.00')).toBe(0);
    expect(compareDecimals('10', '10.01')).toBeLessThan(0);
    expect(compareDecimals('10.000', '9.999')).toBeGreaterThan(0);
  });

  it('ignores leading zeros', () => {
    expect(compareDecimals('007.00', '7.00')).toBe(0);
    expect(compareDecimals('0.50', '00.50')).toBe(0);
  });

  it('keeps precision a float would lose', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; these strings are exact.
    expect(compareDecimals('0.30', '0.30000000000000004')).toBeLessThan(0);
    // Beyond 2^53, every float comparison here would be a coin toss.
    expect(
      compareDecimals('9007199254740993.00', '9007199254740992.00'),
    ).toBeGreaterThan(0);
    expect(
      compareDecimals('12345678901234567890.01', '12345678901234567890.02'),
    ).toBeLessThan(0);
  });

  it('orders negatives below positives', () => {
    expect(compareDecimals('-1.00', '1.00')).toBeLessThan(0);
    expect(compareDecimals('1.00', '-1.00')).toBeGreaterThan(0);
    // Further from zero is smaller.
    expect(compareDecimals('-10.00', '-9.00')).toBeLessThan(0);
    expect(compareDecimals('-9.00', '-10.00')).toBeGreaterThan(0);
    expect(compareDecimals('-9.00', '-9.00')).toBe(0);
  });

  it('answers the question the payment screens ask', () => {
    const balanceCoversPayment = (balance: string, amount: string) =>
      compareDecimals(balance, amount) >= 0;

    expect(balanceCoversPayment('1000.00', '1000.00')).toBe(true);
    expect(balanceCoversPayment('1000.00', '1000.01')).toBe(false);
    expect(balanceCoversPayment('999.99', '1000.00')).toBe(false);
    expect(balanceCoversPayment('0.00', '0.01')).toBe(false);
  });
});

describe('group', () => {
  /** Written with the separator named, so the expectation stays readable. */
  const sep = (text: string) => text.split(' ').join(GROUP_SEPARATOR);

  it('groups the digits without changing them', () => {
    expect(group('1000.00')).toBe(sep('1 000.00'));
    expect(group('1234567.89')).toBe(sep('1 234 567.89'));
    expect(group('999.99')).toBe('999.99');
    expect(group('0.01')).toBe('0.01');
  });

  it('keeps the sign and the exact scale', () => {
    expect(group('-1500.00')).toBe(sep('-1 500.00'));
    expect(group('-27840.5')).toBe(sep('-27 840.5'));
    expect(group('13')).toBe('13');
  });

  it('does not round a value longer than a float can hold', () => {
    expect(group('12345678901234567890.01')).toBe(
      sep('12 345 678 901 234 567 890.01'),
    );
  });
});

describe('isNegative', () => {
  it('is true only for a real loss', () => {
    expect(isNegative('-5000.00')).toBe(true);
    expect(isNegative('-0.01')).toBe(true);
    expect(isNegative('5000.00')).toBe(false);
    expect(isNegative('0.00')).toBe(false);
    // "-0.00" is zero, not a loss.
    expect(isNegative('-0.00')).toBe(false);
    expect(isNegative('-0')).toBe(false);
  });
});
