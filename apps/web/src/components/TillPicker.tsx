import { Link } from 'react-router-dom';
import type { AccountBalance, CurrencyCode } from '../api/types';
import { Money } from './Money';

/**
 * Picks the till the money leaves, and says plainly when it is short.
 *
 * The comparison is done on the digits, not on `Number(...)`: money is
 * Decimal everywhere in this system, and a parsed float would be a rounding
 * bug hiding in a warning banner. When the till cannot cover the payment the
 * only correct next step is to buy currency (§10-А.1), so the screen links
 * straight to it rather than letting the person hit a 409.
 */
export function TillPicker({
  accounts,
  currency,
  value,
  amount,
  onChange,
}: {
  accounts: AccountBalance[];
  currency: CurrencyCode;
  value: string;
  amount: string;
  onChange: (accountId: string) => void;
}) {
  const tills = accounts.filter(
    (account) => account.currency === currency && account.is_active,
  );
  const selected = tills.find((till) => till.account_id === value);
  const short =
    selected && amount.trim() !== ''
      ? compareDecimals(selected.balance, amount) < 0
      : false;

  return (
    <>
      <label>
        Кайсы кассадан ({currency})
        <select value={value} onChange={(e) => onChange(e.target.value)} required>
          <option value="">—</option>
          {tills.map((till) => (
            <option key={till.account_id} value={till.account_id}>
              {till.name} — {till.balance} {till.currency}
            </option>
          ))}
        </select>
      </label>

      {tills.length === 0 && (
        <p className="banner warn">
          {currency} кассасы жок. Адегенде валюта сатып алыңыз:{' '}
          <Link to="/currency-exchange">CEX</Link>.
        </p>
      )}

      {selected && (
        <p className={`banner ${short ? 'warn' : 'info'}`}>
          Кассада: <Money value={selected.balance} currency={currency} />
          {short && (
            <>
              {' '}— бул төлөмгө жетпейт.{' '}
              <Link to={`/currency-exchange?to_account=${selected.account_id}`}>
                Валюта сатып алуу (CEX)
              </Link>
            </>
          )}
        </p>
      )}
    </>
  );
}

/**
 * Compares two decimal strings without turning either into a float.
 *
 * Returns a negative number when `a < b`, zero when equal, positive when
 * `a > b`. Both are non-negative amounts as the API sends them, so this
 * compares the integer part by length then the padded digits lexically.
 */
export function compareDecimals(a: string, b: string): number {
  const [aWhole, aFraction = ''] = a.trim().split('.');
  const [bWhole, bFraction = ''] = b.trim().split('.');

  const aNegative = aWhole.startsWith('-');
  const bNegative = bWhole.startsWith('-');
  if (aNegative !== bNegative) return aNegative ? -1 : 1;

  const sign = aNegative ? -1 : 1;
  const aDigits = aWhole.replace('-', '').replace(/^0+(?=\d)/, '');
  const bDigits = bWhole.replace('-', '').replace(/^0+(?=\d)/, '');

  if (aDigits.length !== bDigits.length) {
    return sign * (aDigits.length - bDigits.length);
  }
  if (aDigits !== bDigits) {
    return sign * (aDigits < bDigits ? -1 : 1);
  }

  const width = Math.max(aFraction.length, bFraction.length);
  const aPadded = aFraction.padEnd(width, '0');
  const bPadded = bFraction.padEnd(width, '0');
  if (aPadded === bPadded) return 0;
  return sign * (aPadded < bPadded ? -1 : 1);
}
