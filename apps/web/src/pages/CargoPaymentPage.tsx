import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { AccountBalance, CargoCompany, CurrencyCode } from '../api/types';
import { ErrorBanner, Loading, Page } from '../components/Page';
import { TillPicker } from '../components/TillPicker';
import { useApi } from '../hooks/useApi';

/**
 * CPY (§5.2): pay the carrier.
 *
 * The account's currency decides how it works — a USD till draws on the
 * currency FIFO and needs no rate, while paying in som needs the rate used,
 * because the cargo debt itself is in dollars.
 */
export function CargoPaymentPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const companies = useApi<CargoCompany[]>('/cargo-companies');
  const accounts = useApi<AccountBalance[]>('/accounts/balances');

  const [companyId, setCompanyId] = useState(params.get('cargo_company_id') ?? '');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [fromAccount, setFromAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsRate = currency === 'KGS';

  function pickCurrency(next: CurrencyCode) {
    setCurrency(next);
    setFromAccount('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/cargo-payments', {
        method: 'POST',
        body: {
          cargo_company_id: companyId,
          from_account: fromAccount,
          amount: amount.trim(),
          ...(needsRate ? { rate: rate.trim() } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
      });
      await api(`/documents/${document.id}/confirm`, { method: 'POST' });
      navigate(`/cargo/${companyId}`);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = companies.data !== null && accounts.data !== null;

  return (
    <Page title="Каргого төлөм (CPY)" back="/cargo">
      <ErrorBanner message={companies.error ?? accounts.error} />
      {!ready && <Loading />}

      {ready && (
      <form className="card" onSubmit={submit}>
        <ErrorBanner message={error} />

        <label>
          Карго компания
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            required
          >
            <option value="">—</option>
            {(companies.data ?? []).map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Кайсы валюта менен төлөйбүз
          <select
            value={currency}
            onChange={(e) => pickCurrency(e.target.value as CurrencyCode)}
          >
            <option value="USD">USD кассадан</option>
            <option value="KGS">Сом кассадан</option>
          </select>
        </label>

        <label>
          Сумма ({currency})
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            required
          />
        </label>

        <TillPicker
          accounts={accounts.data ?? []}
          currency={currency}
          value={fromAccount}
          amount={amount}
          onChange={setFromAccount}
        />

        {needsRate && (
          <label>
            Курс (1 USD канча сом)
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              placeholder="87.00"
              required
            />
          </label>
        )}

        <label>
          Комментарий
          <input value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>

        <button type="submit" disabled={busy || !companyId || !fromAccount}>
          {busy ? 'Жүрүүдө…' : 'Төлөө жана бекитүү'}
        </button>
      </form>
      )}
    </Page>
  );
}
