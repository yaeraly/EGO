import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { Inventory, Warehouse } from '../api/types';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/** Inventories (§22) — what has been counted, and what is still open. */
export function InventoriesPage() {
  const navigate = useNavigate();
  const inventories = useApi<Inventory[]>('/inventories');
  const warehouses = useApi<Warehouse[]>('/warehouses');
  const [warehouseId, setWarehouseId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/inventories', {
        method: 'POST',
        body: { warehouse_id: warehouseId, is_full: true },
      });
      navigate(`/inventories/${document.id}`);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Инвентаризация">
      <form className="card" onSubmit={open}>
        <ErrorBanner message={error} />
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
        <button type="submit" disabled={busy || !warehouseId}>
          {busy ? 'Ачылууда…' : 'Толук саноону баштоо'}
        </button>
        <p className="muted" style={{ margin: 0 }}>
          Толук инвентаризация айына кеминде бир жолу (§22). Айырманын
          складдык корректировкасын ЭЭСИ гана тастыктайт.
        </p>
      </form>

      <ErrorBanner message={inventories.error} />
      {inventories.loading && <Loading />}
      {inventories.data?.length === 0 && <Empty text="Инвентаризация жок." />}

      {(inventories.data ?? []).map((inventory) => (
        <Link
          key={inventory.document.id}
          to={`/inventories/${inventory.document.id}`}
          className="card card-link"
        >
          <div className="row">
            <strong>{inventory.document.doc_number}</strong>
            <span className="muted">{inventory.document.business_date}</span>
          </div>
          <div className="row">
            <span className="muted">{inventory.warehouse.code}</span>
            <span className="muted">
              {inventory.counted_lines} / {inventory.total_lines} саналды
            </span>
          </div>
          <div className="inline">
            <span
              className={`badge ${
                inventory.document.status === 'CONFIRMED' ? 'ok' : 'neutral'
              }`}
            >
              {inventory.document.status === 'CONFIRMED'
                ? 'Тастыкталды'
                : 'Черновик'}
            </span>
            {inventory.shortage_lines > 0 && (
              <span className="badge danger">
                Жетишпейт: {inventory.shortage_lines}
              </span>
            )}
            {inventory.excess_lines > 0 && (
              <span className="badge warn">Ашыкча: {inventory.excess_lines}</span>
            )}
          </div>
        </Link>
      ))}
    </Page>
  );
}
