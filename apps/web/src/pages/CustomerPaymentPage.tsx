import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { AccountBalance, CreditStanding, Customer } from '../api/types';
import { Money } from '../components/Money';
import { ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * Customer payment (PAY) — §16-А.
 *
 * The default is oldest-first and needs no input at all; naming particular
 * sales is the exception (§16-А.2). Any surplus becomes an advance, and the
 * screen says so before the cashier takes the money (§16-А.5).
 */
export function CustomerPaymentPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const customerId = params.get('customer_id') ?? '';

  const customer = useApi<Customer>(customerId ? `/customers/${customerId}` : null);
  const credit = useApi<CreditStanding>(
    customerId ? `/sales/credit/${customerId}` : null,
  );
  const accounts = useApi<AccountBalance[]>('/accounts/balances');

  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [manual, setManual] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tills = (accounts.data ?? []).filter(
    (account) => account.currency === 'KGS' && account.is_active,
  );

  const openDebt = Number(credit.data?.current_open_debt ?? '0');
  const paying = Number(amount || '0');
  const overpayment = Math.max(paying - openDebt, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const allocations = Object.entries(manual)
        .filter(([, value]) => value.trim())
        .map(([saleId, value]) => ({ sale_id: saleId, amount: value.trim() }));

      const document = await api<{ id: string }>('/customer-payments', {
        method: 'POST',
        body: {
          customer_id: customerId,
          lines: [{ account_id: accountId, amount: amount.trim() }],
          ...(allocations.length ? { allocations } : {}),
        },
      });
      await api(`/documents/${document.id}/confirm`, { method: 'POST' });
      navigate(`/customers/${customerId}`);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!customerId) {
    return (
      <Page title="Кардар төлөмү" back="/customers">
        <ErrorBanner message="Кардар көрсөтүлгөн жок" />
      </Page>
    );
  }
  if (customer.loading || credit.loading) {
    return <Page title="Кардар төлөмү" back="/customers"><Loading /></Page>;
  }

  return (
    <Page title="Кардар төлөмү (PAY)" back={`/customers/${customerId}`}>
      <form className="card" onSubmit={submit}>
        <div className="row">
          <strong>{customer.data?.name}</strong>
          <Money value={credit.data?.current_open_debt ?? '0.00'} currency="KGS" />
        </div>

        <ErrorBanner message={error} />

        <label>
          Кайсы эсепке
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
          >
            <option value="">—</option>
            {tills.map((till) => (
              <option key={till.account_id} value={till.account_id}>
                {till.name} ({till.type})
              </option>
            ))}
          </select>
        </label>

        <label>
          Сумма
          <input
            value={amount}
            inputMode="decimal"
            placeholder="0.00"
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>

        {overpayment > 0 && (
          <p className="banner warn">
            Ашыкча {overpayment.toFixed(2)} сом — аванс (ADV) катары катталат
            жана кийинки сатууга колдонулат (§16-А.5). Кардарга айтыңыз.
          </p>
        )}

        {(credit.data?.open_debts ?? []).length > 0 && (
          <>
            <h3 className="section-title">Кайсы карызга (эрктүү — §16-А.2)</h3>
            <p className="muted" style={{ margin: 0 }}>
              Бош калтырсаңыз эң эски карыздан баштап жабылат (§16-А.1).
            </p>
            {(credit.data?.open_debts ?? []).map((debt) => (
              <label key={debt.sale_id}>
                {debt.doc_number} — калдык {debt.outstanding} сом
                {debt.is_overdue && ' (мөөнөтү өттү)'}
                <input
                  value={manual[debt.sale_id] ?? ''}
                  inputMode="decimal"
                  placeholder="0.00"
                  onChange={(e) =>
                    setManual((rows) => ({ ...rows, [debt.sale_id]: e.target.value }))
                  }
                />
              </label>
            ))}
          </>
        )}

        <button type="submit" disabled={busy || !accountId || !amount.trim()}>
          {busy ? 'Кабыл алынууда…' : 'Төлөмдү кабыл алуу'}
        </button>
      </form>
    </Page>
  );
}
