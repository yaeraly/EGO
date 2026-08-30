import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { AccountBalance } from '../api/types';
import { Money } from '../components/Money';
import { ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * CEX (§10-А): buy foreign currency with som.
 *
 * Rate is not entered — the two amounts *are* the rate, and every yuan bought
 * becomes a FIFO layer at what it actually cost (§10-А.3). This is where the
 * payment screens send you when a till is short.
 */
export function CurrencyExchangePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const accounts = useApi<AccountBalance[]>('/accounts/balances');

  const [fromAccount, setFromAccount] = useState('');
  const [toAccount, setToAccount] = useState(params.get('to_account') ?? '');
  const [given, setGiven] = useState('');
  const [received, setReceived] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const all = accounts.data ?? [];
  const som = all.filter((a) => a.currency === 'KGS' && a.is_active);
  const foreign = all.filter((a) => a.currency !== 'KGS' && a.is_active);
  const source = som.find((a) => a.account_id === fromAccount);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/currency-exchanges', {
        method: 'POST',
        body: {
          from_account: fromAccount,
          to_account: toAccount,
          given_amount: given.trim(),
          received_amount: received.trim(),
        },
      });
      await api(`/documents/${document.id}/confirm`, { method: 'POST' });
      navigate('/accounts');
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Валюта сатып алуу (CEX)" back="/accounts">
      <ErrorBanner message={accounts.error} />
      {/* Same reason as the payment forms: the till passed in the link can
          only be preselected once its option exists. */}
      {accounts.data === null && <Loading />}

      {accounts.data !== null && (
      <form className="card" onSubmit={submit}>
        <ErrorBanner message={error} />

        <label>
          Сом кассасынан
          <select
            value={fromAccount}
            onChange={(e) => setFromAccount(e.target.value)}
            required
          >
            <option value="">—</option>
            {som.map((account) => (
              <option key={account.account_id} value={account.account_id}>
                {account.name} — {account.balance} KGS
              </option>
            ))}
          </select>
        </label>
        {source && (
          <p className="banner info">
            Кассада: <Money value={source.balance} currency="KGS" />
          </p>
        )}

        <label>
          Берилген сумма (KGS)
          <input
            value={given}
            onChange={(e) => setGiven(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            required
          />
        </label>

        <label>
          Валюта кассасына
          <select
            value={toAccount}
            onChange={(e) => setToAccount(e.target.value)}
            required
          >
            <option value="">—</option>
            {foreign.map((account) => (
              <option key={account.account_id} value={account.account_id}>
                {account.name} — {account.balance} {account.currency}
              </option>
            ))}
          </select>
        </label>

        <label>
          Алынган сумма
          <input
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            required
          />
        </label>

        <p className="muted" style={{ margin: 0 }}>
          Курс өзүнчө киргизилбейт: эки сумма курсту өзү берет, ошол курс менен
          FIFO layer түзүлөт (§10-А.3).
        </p>

        <button type="submit" disabled={busy || !fromAccount || !toAccount}>
          {busy ? 'Жүрүүдө…' : 'Сатып алуу жана бекитүү'}
        </button>
      </form>
      )}
    </Page>
  );
}
