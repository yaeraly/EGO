import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { LayerView, ProductStock, Warehouse, WarehouseTransfer } from '../api/types';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Черновик',
  SENT: 'Жөнөтүлдү',
  RECEIVED: 'Кабыл алынды',
  CANCELLED: 'Жокко чыгарылды',
};

/**
 * Warehouse transfers (TRF) — §12-А.4–5.
 *
 * Two steps, because that is what happens: goods leave, and later arrive. A
 * transfer still in flight blocks the day's close.
 */
export function TransfersPage() {
  const navigate = useNavigate();
  const transfers = useApi<(WarehouseTransfer & { documents: { doc_number: string; business_date: string } })[]>(
    '/warehouse-transfers',
  );
  const warehouses = useApi<Warehouse[]>('/warehouses');
  const stock = useApi<ProductStock[]>('/stock');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [productId, setProductId] = useState('');
  const [layerId, setLayerId] = useState('');
  const [qty, setQty] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const layers = useApi<LayerView[]>(
    productId ? `/stock/products/${productId}/layers` : null,
  );
  const inWarehouse = (layers.data ?? []).filter(
    (layer) => layer.warehouse_id === from,
  );

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/warehouse-transfers', {
        method: 'POST',
        body: {
          from_warehouse: from,
          to_warehouse: to,
          items: [{ layer_id: layerId, qty: qty.trim() }],
        },
      });
      // Confirming the document is the send: the goods leave now.
      await api(`/documents/${document.id}/confirm`, { method: 'POST' });
      setQty('');
      setLayerId('');
      transfers.reload();
      stock.reload();
      navigate('/transfers');
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function receive(id: string) {
    setError(null);
    try {
      await api(`/warehouse-transfers/${id}/receive`, { method: 'POST' });
      transfers.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  const byId = new Map((warehouses.data ?? []).map((w) => [w.id, w]));

  return (
    <Page title="Складдар аралык которуу (TRF)">
      <form className="card" onSubmit={create}>
        <h3 className="section-title">Жаңы которуу</h3>
        <ErrorBanner message={error} />

        <div className="inline">
          <label style={{ flex: 1 }}>
            Кайдан
            <select value={from} onChange={(e) => setFrom(e.target.value)} required>
              <option value="">—</option>
              {(warehouses.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>{w.code}</option>
              ))}
            </select>
          </label>
          <label style={{ flex: 1 }}>
            Кайда
            <select value={to} onChange={(e) => setTo(e.target.value)} required>
              <option value="">—</option>
              {(warehouses.data ?? [])
                .filter((w) => w.id !== from)
                .map((w) => (
                  <option key={w.id} value={w.id}>{w.code}</option>
                ))}
            </select>
          </label>
        </div>

        <label>
          Товар
          <select
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              setLayerId('');
            }}
            required
          >
            <option value="">—</option>
            {(stock.data ?? []).map((entry) => (
              <option key={entry.product_id} value={entry.product_id}>
                {entry.name} ({entry.sku})
              </option>
            ))}
          </select>
        </label>

        {productId && (
          <label>
            Партия (катмар) — өздүк наркы менен көчөт (§12-А.5)
            <select value={layerId} onChange={(e) => setLayerId(e.target.value)} required>
              <option value="">—</option>
              {inWarehouse.map((layer) => (
                <option key={layer.layer_id} value={layer.layer_id}>
                  {layer.lot_number ?? layer.source} · {layer.qty} даана ×{' '}
                  {layer.unit_cost}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          Саны
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            required
          />
        </label>

        <button type="submit" disabled={busy || !from || !to || !layerId}>
          {busy ? 'Жөнөтүлүүдө…' : 'Жөнөтүү'}
        </button>
      </form>

      {transfers.loading && <Loading />}
      {transfers.data && transfers.data.length === 0 && (
        <Empty text="Которуу жок." />
      )}

      {(transfers.data ?? []).map((transfer) => (
        <div className="card" key={transfer.document_id}>
          <div className="row">
            <strong>{transfer.documents.doc_number}</strong>
            <span
              className={`badge ${transfer.tstatus === 'RECEIVED' ? 'ok' : transfer.tstatus === 'SENT' ? 'warn' : 'neutral'}`}
            >
              {STATUS_LABEL[transfer.tstatus]}
            </span>
          </div>
          <div className="muted">
            {byId.get(transfer.from_warehouse)?.code} →{' '}
            {byId.get(transfer.to_warehouse)?.code}
          </div>
          {transfer.tstatus === 'SENT' && (
            <>
              <p className="banner warn">
                Жолдо: кабыл алынмайынча күндү жабууга болбойт.
              </p>
              <button onClick={() => receive(transfer.document_id)}>
                Кабыл алуу
              </button>
            </>
          )}
        </div>
      ))}
    </Page>
  );
}

/** Warehouses (§12-А.1). Read by everyone; the OWNER adds them. */
export function WarehousesPage() {
  const warehouses = useApi<Warehouse[]>('/warehouses?include_inactive=true');

  return (
    <Page title="Складдар" back="/stock">
      <ErrorBanner message={warehouses.error} />
      {warehouses.loading && <Loading />}
      {(warehouses.data ?? []).map((warehouse) => (
        <div className="card" key={warehouse.id}>
          <div className="row">
            <strong>{warehouse.code}</strong>
            {!warehouse.is_active && (
              <span className="badge neutral">Активдүү эмес</span>
            )}
          </div>
          <div className="muted">{warehouse.name}</div>
          <div className="inline">
            <span className="badge info">{warehouse.wtype}</span>
            {warehouse.wtype === 'DEFECT' && (
              <span className="muted">Сатууга жеткиликтүү эмес (§12-А.6)</span>
            )}
          </div>
        </div>
      ))}
    </Page>
  );
}
