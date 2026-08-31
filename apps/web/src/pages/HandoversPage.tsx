import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { AuthUser, Handover, HandoverItem, Warehouse } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/** Handover acts (§21) — who answers for the stock, and since when. */
export function HandoversPage() {
  const navigate = useNavigate();
  const handovers = useApi<Handover[]>('/handovers');
  const users = useApi<AuthUser[]>('/users');
  const warehouses = useApi<Warehouse[]>('/warehouses');

  const [toUser, setToUser] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/handovers', {
        method: 'POST',
        body: { to_user: toUser, warehouse_id: warehouseId },
      });
      navigate(`/handovers/${document.id}`);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Жоопкерчиликти өткөрүү">
      <form className="card" onSubmit={open}>
        <ErrorBanner message={error} />
        <label>
          Кимге өткөрүлөт
          <select value={toUser} onChange={(e) => setToUser(e.target.value)} required>
            <option value="">—</option>
            {(users.data ?? []).map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Кайсы склад
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            required
          >
            <option value="">—</option>
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} — {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy || !toUser || !warehouseId}>
          {busy ? 'Түзүлүүдө…' : 'Акт түзүү'}
        </button>
        <p className="muted" style={{ margin: 0 }}>
          Толук инвентаризация талап кылынбайт: A-класс товарлар толук, калганынан
          система өзү бир нече позиция тандайт (§21.1).
        </p>
      </form>

      <ErrorBanner message={handovers.error} />
      {handovers.loading && <Loading />}
      {handovers.data?.length === 0 && <Empty text="Акт жок." />}

      {(handovers.data ?? []).map((act) => (
        <Link
          key={act.document_id}
          to={`/handovers/${act.document_id}`}
          className="card card-link"
        >
          <div className="row">
            <strong>{act.documents.doc_number}</strong>
            <span className="muted">{act.documents.business_date.slice(0, 10)}</span>
          </div>
          <div className="inline">
            <span
              className={`badge ${
                act.documents.status === 'CONFIRMED' ? 'ok' : 'neutral'
              }`}
            >
              {act.documents.status === 'CONFIRMED'
                ? 'Өткөрүлдү'
                : 'Кол коюла элек'}
            </span>
            {act.difference !== '0.00' && (
              <span className="badge warn">Айырма {act.difference}</span>
            )}
          </div>
        </Link>
      ))}
    </Page>
  );
}

/** One act: count together, then both sign (§21.1). */
export function HandoverPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const act = useApi<Handover>(id ? `/handovers/${id}` : null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const items = Object.entries(counts)
      .filter(([, value]) => value.trim())
      .map(([itemId, value]) => ({ item_id: itemId, actual_qty: value.trim() }));
    if (items.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      await api(`/handovers/${id}/count`, { method: 'PATCH', body: { items } });
      setCounts({});
      act.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sign() {
    setBusy(true);
    setError(null);
    try {
      await api(`/handovers/${id}/sign`, { method: 'POST', body: {} });
      act.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (act.loading) {
    return <Page title="Акт" back="/handovers"><Loading /></Page>;
  }
  if (!act.data) {
    return (
      <Page title="Акт" back="/handovers">
        <ErrorBanner message={act.error ?? 'Табылган жок'} />
      </Page>
    );
  }

  const data = act.data;
  const open = data.documents.status === 'DRAFT';
  const mySide =
    data.from_user === user?.id ? 'from' : data.to_user === user?.id ? 'to' : null;
  const iSigned =
    mySide === 'from' ? Boolean(data.from_confirmed_at) : Boolean(data.to_confirmed_at);

  return (
    <Page title={data.documents.doc_number} back="/handovers">
      <ErrorBanner message={error} />

      <div className="card">
        <div className="row">
          <span className="muted">Өткөрүп жаткан</span>
          <span>{data.from_confirmed_at ? '✓ кол койду' : 'кол коё элек'}</span>
        </div>
        <div className="row">
          <span className="muted">Кабыл алган</span>
          <span>{data.to_confirmed_at ? '✓ кол койду' : 'кол коё элек'}</span>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Жоопкерчилик эки тарап тең кол койгондо гана өтөт (§21.1).
        </p>
      </div>

      {data.handover_checked_items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          editable={open && !data.from_confirmed_at && !data.to_confirmed_at}
          value={counts[item.id] ?? ''}
          onChange={(value) => setCounts((rows) => ({ ...rows, [item.id]: value }))}
        />
      ))}

      {open && (
        <div className="card">
          {!data.from_confirmed_at && !data.to_confirmed_at && (
            <button type="button" onClick={save} disabled={busy}>
              Сандарды сактоо
            </button>
          )}
          {mySide && !iSigned && (
            <button type="button" onClick={sign} disabled={busy}>
              Кол коюу
            </button>
          )}
          {mySide === null && (
            <p className="muted" style={{ margin: 0 }}>
              Бул актка ага катышкан эки кызматкер гана кол коёт.
            </p>
          )}
        </div>
      )}
    </Page>
  );
}

function ItemRow({
  item,
  editable,
  value,
  onChange,
}: {
  item: HandoverItem;
  editable: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const diff = Number(item.actual_qty) - Number(item.system_qty);

  return (
    <div className="card">
      <div className="row">
        <strong>{item.product_id.slice(0, 8)}</strong>
        {item.is_a_class && <span className="badge warn">A-класс</span>}
      </div>
      <div className="row">
        <span className="muted">Системада</span>
        <span>{item.system_qty}</span>
      </div>
      {editable ? (
        <label>
          Факт
          <input
            value={value}
            inputMode="decimal"
            placeholder={item.actual_qty}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      ) : (
        <div className="row">
          <span className="muted">Факт</span>
          <span>{item.actual_qty}</span>
        </div>
      )}
      {diff !== 0 && (
        <div className="row">
          <span className="muted">Айырма</span>
          <span className={diff < 0 ? 'money negative' : 'money'}>
            {diff.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
}
