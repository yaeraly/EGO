import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PurchaseListItem, PurchaseStatus, Supplier } from '../api/types';
import { LogisticsBadge, PaymentBadge, STATUS_LABEL } from '../components/Badges';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

const STAGES = Object.keys(STATUS_LABEL) as PurchaseStatus[];

/** The scanning screen (§2.8): every order, where it is, and what it owes. */
export function PurchaseListPage() {
  const [status, setStatus] = useState<PurchaseStatus | ''>('');
  const [supplierId, setSupplierId] = useState('');

  const query = new URLSearchParams();
  if (status) query.set('logistics_status', status);
  if (supplierId) query.set('supplier_id', supplierId);
  const suffix = query.toString() ? `?${query}` : '';

  const suppliers = useApi<Supplier[]>('/suppliers');
  const { data, error, loading } = useApi<PurchaseListItem[]>(
    `/purchase-board${suffix}`,
  );

  return (
    <Page title="Сатып алуулар">
      <div className="card">
        <label>
          Логистика статусу
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as PurchaseStatus | '')}
          >
            <option value="">Баары</option>
            {STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STATUS_LABEL[stage]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Поставщик
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Баары</option>
            {(suppliers.data ?? []).map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorBanner message={error} />
      {loading && <Loading />}
      {data && data.length === 0 && <Empty text="Заказ жок." />}

      {(data ?? []).map((row) => (
        <Link
          key={row.document_id}
          to={`/purchases/${row.document_id}`}
          className="card card-link"
        >
          <div className="row">
            <strong>{row.doc_number}</strong>
            <Money value={row.total_cny} currency="CNY" />
          </div>
          <div className="row">
            <span className="muted">{row.supplier.name}</span>
            <span className="muted">{row.business_date.slice(0, 10)}</span>
          </div>
          <div className="inline">
            <LogisticsBadge status={row.logistics_status} />
            <PaymentBadge status={row.payment_status} />
            {/* "Черновик" is already the §6 stage-1 label, so the document's
                own draft state says what it means instead of repeating it. */}
            {row.document_status === 'DRAFT' && (
              <span className="badge warn">Бекитилген эмес</span>
            )}
          </div>
          {row.paid_cny !== '0.00' && (
            <div className="muted">
              Төлөндү: <Money value={row.paid_cny} currency="CNY" />
            </div>
          )}
        </Link>
      ))}
    </Page>
  );
}
