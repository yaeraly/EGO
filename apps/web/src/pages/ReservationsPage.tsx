import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { Customer, Product, Reservation, ReservationStatus } from '../api/types';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  ACTIVE: 'Активдүү',
  FULFILLED: 'Сатылды',
  CANCELLED: 'Жокко чыгарылды',
  EXPIRED: 'Мөөнөтү өттү',
};

/** Reservations (§17) — what is being held, for whom, and until when. */
export function ReservationsPage() {
  const [status, setStatus] = useState<ReservationStatus | ''>('ACTIVE');
  const reservations = useApi<Reservation[]>(
    `/reservations${status ? `?status=${status}` : ''}`,
  );

  return (
    <Page
      title="Броньдор"
      actions={
        <Link to="/reservations/new" className="badge ok">
          + Жаңы
        </Link>
      }
    >
      <div className="card">
        <label>
          Абалы
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ReservationStatus | '')}
          >
            <option value="">Баары</option>
            {(Object.keys(RESERVATION_STATUS_LABEL) as ReservationStatus[]).map(
              (value) => (
                <option key={value} value={value}>
                  {RESERVATION_STATUS_LABEL[value]}
                </option>
              ),
            )}
          </select>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          Брондолгон товар башка кардарга сатылбайт (§42.2). Мөөнөтү бүткөндө
          товар өзү бошойт (§17.3).
        </p>
      </div>

      <ErrorBanner message={reservations.error} />
      {reservations.loading && <Loading />}
      {reservations.data?.length === 0 && <Empty text="Бронь жок." />}

      {(reservations.data ?? []).map((reservation) => (
        <Link
          key={reservation.document.id}
          to={`/reservations/${reservation.document.id}`}
          className="card card-link"
        >
          <div className="row">
            <strong>{reservation.document.doc_number}</strong>
            <Money value={reservation.total_amount} currency="KGS" />
          </div>
          <div className="row">
            <span className="muted">{reservation.customer.name}</span>
            <span className="muted">{expiryLabel(reservation)}</span>
          </div>
          <div className="inline">
            <span className={`badge ${badgeOf(reservation)}`}>
              {RESERVATION_STATUS_LABEL[reservation.status]}
            </span>
            {reservation.advance_outstanding !== '0.00' && (
              <span className="badge warn">
                Аванс керек: {reservation.advance_outstanding}
              </span>
            )}
          </div>
        </Link>
      ))}
    </Page>
  );
}

export function badgeOf(reservation: Reservation): string {
  if (reservation.status === 'ACTIVE') return reservation.is_live ? 'ok' : 'warn';
  if (reservation.status === 'FULFILLED') return 'ok';
  return 'neutral';
}

export function expiryLabel(reservation: Reservation): string {
  const at = new Date(reservation.expires_at);
  const date = at.toISOString().slice(0, 10);
  const time = at.toISOString().slice(11, 16);
  return `${date} ${time}`;
}

/** Creating a reservation: who, what, and until when (§17). */
export function ReservationFormPage() {
  const navigate = useNavigate();
  const customers = useApi<Customer[]>('/customers');
  const products = useApi<Product[]>('/products');

  const [customerId, setCustomerId] = useState('');
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());
  const [rows, setRows] = useState([{ product_id: '', qty: '1' }]);
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = !customers.loading && !products.loading;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/reservations', {
        method: 'POST',
        body: {
          customer_id: customerId,
          expires_at: new Date(expiresAt).toISOString(),
          items: rows
            .filter((row) => row.product_id && row.qty.trim())
            .map((row) => ({ product_id: row.product_id, qty: row.qty.trim() })),
          ...(overrideReason.trim()
            ? { override_reason: overrideReason.trim() }
            : {}),
        },
      });
      await api(`/documents/${document.id}/confirm`, { method: 'POST' });
      navigate(`/reservations/${document.id}`);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <Page title="Жаңы бронь" back="/reservations">
        <Loading />
      </Page>
    );
  }

  return (
    <Page title="Жаңы бронь" back="/reservations">
      <form className="card" onSubmit={submit}>
        <ErrorBanner message={error} />

        <label>
          Кардар
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            required
          >
            <option value="">—</option>
            {(customers.data ?? [])
              .filter((customer) => !customer.is_walk_in)
              .map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
          </select>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          Walk-in кардарга бронь түзүлбөйт (§17.3).
        </p>

        <label>
          Качанга чейин
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            required
          />
        </label>

        <h3 className="section-title">Товарлар</h3>
        {rows.map((row, index) => (
          <div className="inline" key={index}>
            <label style={{ flex: 3 }}>
              Товар
              <select
                value={row.product_id}
                onChange={(e) =>
                  setRows((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, product_id: e.target.value } : item,
                    ),
                  )
                }
              >
                <option value="">—</option>
                {(products.data ?? []).map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.sku} — {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ flex: 1 }}>
              Саны
              <input
                value={row.qty}
                inputMode="decimal"
                onChange={(e) =>
                  setRows((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, qty: e.target.value } : item,
                    ),
                  )
                }
              />
            </label>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRows((current) => [...current, { product_id: '', qty: '1' }])}
        >
          + Сап кошуу
        </button>

        <label>
          Ээсинин уруксаты (керек болсо)
          <input
            value={overrideReason}
            placeholder="Мөөнөтү өткөн карыз же бронь лимити үчүн себеп"
            onChange={(e) => setOverrideReason(e.target.value)}
          />
        </label>

        <button type="submit" disabled={busy || !customerId}>
          {busy ? 'Түзүлүүдө…' : 'Бронду түзүү'}
        </button>
        <p className="muted" style={{ margin: 0 }}>
          Баа ушул учурдагы баа менен бекитилет (§17.1). Сатууда өздүк нарк
          көтөрүлүп кетсе, §13.4 боюнча кайра текшерилет.
        </p>
      </form>
    </Page>
  );
}

function defaultExpiry(): string {
  const at = new Date(Date.now() + 24 * 3_600_000);
  return at.toISOString().slice(0, 16);
}
