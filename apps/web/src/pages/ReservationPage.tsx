import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { AccountBalance, Advance, Reservation } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';
import { RESERVATION_STATUS_LABEL, badgeOf, expiryLabel } from './ReservationsPage';

/** One reservation: what it holds, what has been paid, what can be done. */
export function ReservationPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const reservation = useApi<Reservation>(id ? `/reservations/${id}` : null);
  const accounts = useApi<AccountBalance[]>('/accounts/balances');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const advances = useApi<Advance[]>(
    reservation.data ? `/advances?customer_id=${reservation.data.customer.id}` : null,
  );

  async function cancel() {
    const reason = window.prompt('Жокко чыгаруу себеби (§17.2):');
    if (!reason?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/reservations/${id}/cancel`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      reservation.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sell() {
    setBusy(true);
    setError(null);
    try {
      const sale = await api<{ id: string }>('/sales', {
        method: 'POST',
        body: { from_reservation: id },
      });
      navigate(`/sell/${sale.id}`);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (reservation.loading) {
    return <Page title="Бронь" back="/reservations"><Loading /></Page>;
  }
  if (!reservation.data) {
    return (
      <Page title="Бронь" back="/reservations">
        <ErrorBanner message={reservation.error ?? 'Бронь табылган жок'} />
      </Page>
    );
  }

  const data = reservation.data;
  const tills = (accounts.data ?? []).filter(
    (account) =>
      account.currency === 'KGS' &&
      account.is_active &&
      account.owner_user === user?.id,
  );

  return (
    <Page title={data.document.doc_number} back="/reservations">
      <ErrorBanner message={error} />

      <div className="card">
        <div className="row">
          <strong>{data.customer.name}</strong>
          <Money value={data.total_amount} currency="KGS" />
        </div>
        <div className="row">
          <span className="muted">Мөөнөтү</span>
          <span>{expiryLabel(data)}</span>
        </div>
        <div className="inline">
          <span className={`badge ${badgeOf(data)}`}>
            {RESERVATION_STATUS_LABEL[data.status]}
          </span>
          {data.status === 'ACTIVE' && !data.is_live && (
            <span className="badge warn">Мөөнөтү өткөн — товар бошотулду</span>
          )}
        </div>
        {data.cancel_reason && (
          <p className="muted">Себеби: {data.cancel_reason}</p>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Товарлар — баасы бекитилген (§17.1)</h3>
        {data.items.map((item) => (
          <div className="row" key={item.product_id}>
            <span>
              {item.name}
              <span className="muted"> · {item.sku}</span>
            </span>
            <span>
              {item.qty} × <Money value={item.fixed_price} />
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="section-title">Аванс (§17.3, §17-А)</h3>
        <div className="row">
          <span>Талап кылынат</span>
          <Money value={data.advance_required} currency="KGS" />
        </div>
        <div className="row">
          <span>Төлөндү</span>
          <Money value={data.advance_paid} currency="KGS" />
        </div>
        {data.advance_outstanding !== '0.00' && (
          <p className="banner warn">
            Дагы {data.advance_outstanding} сом аванс керек — ансыз бронь толук
            бекитилбейт (§17.3).
          </p>
        )}

        {data.is_live && (
          <TakeAdvance
            customerId={data.customer.id}
            reservationId={data.document.id}
            tills={tills}
            onDone={() => {
              reservation.reload();
              advances.reload();
            }}
          />
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Кардардын авансы</h3>
        {(advances.data ?? []).length === 0 && <Empty text="Аванс жок." />}
        {(advances.data ?? []).map((advance) => (
          <div className="row" key={advance.document_id}>
            <span className="muted">
              {advance.documents_advances_document_idTodocuments.doc_number}
            </span>
            <span>
              <Money value={advance.amount} currency="KGS" />
              {advance.applied_amount !== '0.00' && (
                <span className="muted"> · колдонулду {advance.applied_amount}</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {data.is_live && (
        <div className="card">
          <button type="button" onClick={sell} disabled={busy}>
            Сатууга өткөрүү
          </button>
          <button type="button" className="danger" onClick={cancel} disabled={busy}>
            Бронду жокко чыгаруу
          </button>
          <p className="muted" style={{ margin: 0 }}>
            Жокко чыгарылса аванс кардарга кайтарылат (§17.2) — кайтаруу
            аванстын өз документинде PIN менен жүргүзүлөт (§17-А.4).
          </p>
        </div>
      )}
    </Page>
  );
}

/** §17-А.1 — money in now, revenue later. */
function TakeAdvance({
  customerId,
  reservationId,
  tills,
  onDone,
}: {
  customerId: string;
  reservationId: string;
  tills: AccountBalance[];
  onDone: () => void;
}) {
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/advances', {
        method: 'POST',
        body: {
          customer_id: customerId,
          reservation_id: reservationId,
          account_id: accountId,
          amount: amount.trim(),
        },
      });
      await api(`/documents/${document.id}/confirm`, { method: 'POST' });
      setAmount('');
      onDone();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
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
              {till.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Аванс суммасы
        <input
          value={amount}
          inputMode="decimal"
          placeholder="0.00"
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={busy || !accountId || !amount.trim()}>
        {busy ? 'Кабыл алынууда…' : 'Авансты кабыл алуу'}
      </button>
      <p className="muted" style={{ margin: 0 }}>
        Аванс — киреше эмес, кардардын алдындагы милдеттенме (§17-А.1).
      </p>
    </form>
  );
}
