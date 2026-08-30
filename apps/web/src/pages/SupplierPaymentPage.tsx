import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { AccountBalance, Supplier } from '../api/types';
import { ErrorBanner, Loading, Page } from '../components/Page';
import { TillPicker } from '../components/TillPicker';
import { useApi } from '../hooks/useApi';

const CHANNELS = ['ALIPAY', 'WECHAT', 'BANK'] as const;

/** SPY (§4.3): pay a supplier out of the CNY till. */
export function SupplierPaymentPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const suppliers = useApi<Supplier[]>('/suppliers');
  const accounts = useApi<AccountBalance[]>('/accounts/balances');

  const [supplierId, setSupplierId] = useState(params.get('supplier_id') ?? '');
  const [purchaseId] = useState(params.get('purchase_id') ?? '');
  const [fromAccount, setFromAccount] = useState('');
  const [amount, setAmount] = useState(params.get('amount') ?? '');
  const [channel, setChannel] = useState<string>('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/supplier-payments', {
        method: 'POST',
        body: {
          supplier_id: supplierId,
          from_account: fromAccount,
          amount_cny: amount.trim(),
          ...(purchaseId ? { purchase_id: purchaseId } : {}),
          ...(channel ? { channel } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
      });
      // Created as a DRAFT; confirming it is what moves the money (§27.1).
      await api(`/documents/${document.id}/confirm`, { method: 'POST' });
      navigate(purchaseId ? `/purchases/${purchaseId}` : `/suppliers/${supplierId}`);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = suppliers.data !== null && accounts.data !== null;

  return (
    <Page
      title="Поставщикке төлөм (SPY)"
      back={purchaseId ? `/purchases/${purchaseId}` : '/suppliers'}
    >
      <ErrorBanner message={suppliers.error ?? accounts.error} />
      {/* The form waits for its dropdowns: a <select> rendered before its
          options cannot show a value passed in the link, and a half-drawn
          payment form is worse than a moment of waiting. */}
      {!ready && <Loading />}

      {ready && (
      <form className="card" onSubmit={submit}>
        <ErrorBanner message={error} />

        <label>
          Поставщик
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            disabled={Boolean(purchaseId)}
            required
          >
            <option value="">—</option>
            {(suppliers.data ?? []).map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>

        {purchaseId && (
          <p className="muted" style={{ margin: 0 }}>
            Бул заказ боюнча төлөм. Ашыгы поставщиктин аванс катары калат (§4.3).
          </p>
        )}

        <label>
          Сумма (CNY)
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
          currency="CNY"
          value={fromAccount}
          amount={amount}
          onChange={setFromAccount}
        />

        <label>
          Канал
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">—</option>
            {CHANNELS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label>
          Комментарий
          <input value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>

        <button type="submit" disabled={busy || !supplierId || !fromAccount}>
          {busy ? 'Жүрүүдө…' : 'Төлөө жана бекитүү'}
        </button>
      </form>
      )}
    </Page>
  );
}
