import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { PurchaseListItem, Receipt } from '../api/types';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import {
  RECEIPT_STATUS_LABEL,
  receiptStatusTone,
} from '../components/module3-labels';
import { useApi } from '../hooks/useApi';

interface ReceiptRow extends Receipt {
  documents: { doc_number: string; business_date: string; status: string };
  purchases: Receipt['purchases'] & { suppliers: { id: string; name: string } };
}

/** The receipts list, and the way to start one from an order (§7). */
export function ReceiptListPage() {
  const navigate = useNavigate();
  const receipts = useApi<ReceiptRow[]>('/receipts');
  const purchases = useApi<PurchaseListItem[]>('/purchase-board');
  const [purchaseId, setPurchaseId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/receipts', {
        method: 'POST',
        body: { purchase_id: purchaseId },
      });
      navigate(`/receipts/${document.id}`);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const receivable = (purchases.data ?? []).filter(
    (row) => row.document_status === 'CONFIRMED',
  );

  return (
    <Page title="Приходдор">
      <form className="card" onSubmit={open}>
        <h3 className="section-title">Жаңы приход</h3>
        <ErrorBanner message={error} />
        <label>
          Кайсы заказ боюнча
          <select
            value={purchaseId}
            onChange={(e) => setPurchaseId(e.target.value)}
            required
          >
            <option value="">—</option>
            {receivable.map((row) => (
              <option key={row.document_id} value={row.document_id}>
                {row.doc_number} · {row.supplier.name} · {row.total_cny} CNY
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy || !purchaseId}>
          {busy ? 'Ачылууда…' : 'Приход ачуу'}
        </button>
      </form>

      <ErrorBanner message={receipts.error} />
      {receipts.loading && <Loading />}
      {receipts.data && receipts.data.length === 0 && <Empty text="Приход жок." />}

      {(receipts.data ?? []).map((row) => (
        <Link
          key={row.document_id}
          to={`/receipts/${row.document_id}`}
          className="card card-link"
        >
          <div className="row">
            <strong>{row.documents.doc_number}</strong>
            <span className={`badge ${receiptStatusTone(row.rstatus)}`}>
              {RECEIPT_STATUS_LABEL[row.rstatus]}
            </span>
          </div>
          <div className="row">
            <span className="muted">{row.purchases.suppliers.name}</span>
            <span className="muted">
              {row.documents.business_date.slice(0, 10)}
            </span>
          </div>
          {row.rate_cny && (
            <div className="muted">
              Курс {row.rate_cny} ({row.rate_cny_source})
            </div>
          )}
        </Link>
      ))}
    </Page>
  );
}
