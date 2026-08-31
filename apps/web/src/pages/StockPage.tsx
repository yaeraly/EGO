import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { LayerView, ProductStock, Warehouse } from '../api/types';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { WAREHOUSE_TYPE_LABEL } from '../components/module3-labels';
import { useApi } from '../hooks/useApi';

/** Stock at Product + Warehouse + LOT (§12-А.2). */
export function StockPage() {
  const [warehouseId, setWarehouseId] = useState('');
  const warehouses = useApi<Warehouse[]>('/warehouses');
  const stock = useApi<ProductStock[]>(
    warehouseId ? `/stock?warehouse_id=${warehouseId}` : '/stock',
  );

  return (
    <Page title="Склад">
      <div className="card">
        <label>
          Склад
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Баары</option>
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} — {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          DEFECT складындагы товар сатууга жеткиликтүү эмес (§12-А.6).
        </p>
      </div>

      <ErrorBanner message={stock.error} />
      {stock.loading && <Loading />}
      {stock.data && stock.data.length === 0 && <Empty text="Складда товар жок." />}

      {(stock.data ?? []).map((entry) => (
        <Link
          key={entry.product_id}
          to={`/stock/products/${entry.product_id}`}
          className="card card-link"
        >
          <div className="row">
            <strong>{entry.name}</strong>
            <Money value={entry.total_value_kgs} currency="KGS" />
          </div>
          <div className="muted">{entry.sku}</div>
          <div className="inline">
            <span className="badge neutral">Бардыгы {entry.current_qty}</span>
            <span className="badge ok">Сатууга {entry.available_qty}</span>
            {entry.reserved_qty !== '0.00' && (
              <span className="badge warn">Бронь {entry.reserved_qty}</span>
            )}
          </div>
          <div className="inline">
            {entry.by_warehouse.map((warehouse) => (
              <span key={warehouse.warehouse_id} className="muted">
                {warehouse.code}: {warehouse.qty}
              </span>
            ))}
          </div>
        </Link>
      ))}
    </Page>
  );
}

/**
 * The product card's stock half (§12-Б.4, §18.1.3).
 *
 * Every active layer with its own remaining quantity and its own cost — the
 * system does not average them, and this is where that becomes visible.
 */
export function ProductStockPage() {
  const productId = window.location.pathname.split('/').pop() ?? '';
  const layers = useApi<LayerView[]>(`/stock/products/${productId}/layers`);
  const stock = useApi<ProductStock[]>(`/stock?product_id=${productId}`);

  const entry = stock.data?.[0];

  return (
    <Page title={entry?.name ?? 'Товар'} back="/stock">
      {entry && (
        <div className="card">
          <div className="muted">{entry.sku}</div>
          <div className="row">
            <span>Бардыгы</span>
            <strong>{entry.current_qty}</strong>
          </div>
          <div className="row">
            <span>Сатууга жеткиликтүү</span>
            <strong>{entry.available_qty}</strong>
          </div>
          <div className="row">
            <span>Складдык нарк</span>
            <Money value={entry.total_value_kgs} currency="KGS" className="big" />
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="section-title">FIFO катмарлары (§18.1.3)</h3>
        <ErrorBanner message={layers.error} />
        {layers.loading && <Loading />}
        {layers.data && layers.data.length === 0 && (
          <p className="muted">Активдүү катмар жок.</p>
        )}
        <div className="lines">
          {(layers.data ?? []).map((layer) => (
            <div className="line" key={`${layer.layer_id}-${layer.warehouse_id}`}>
              <div>
                <div>{layer.lot_number ?? layer.source}</div>
                <div className="muted">
                  {layer.layer_date} · {layer.warehouse_code} (
                  {WAREHOUSE_TYPE_LABEL[layer.warehouse_type]})
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div>
                  {layer.qty} × <Money value={layer.unit_cost} />
                </div>
                <div className="muted">
                  <Money value={layer.value_kgs} currency="KGS" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Бир товар ар башка партияда ар башка өздүк наркта болушу мүмкүн —
          система аларды орточолоштурбайт (§18).
        </p>
      </div>
    </Page>
  );
}
