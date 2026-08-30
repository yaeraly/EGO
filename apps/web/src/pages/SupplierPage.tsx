import { Link, useParams } from 'react-router-dom';
import type { PurchaseListItem, Supplier, SupplierLedger } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { LogisticsBadge, PaymentBadge } from '../components/Badges';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/** The supplier's own ledger entry types (§4.3). */
const ENTRY_LABEL: Record<string, string> = {
  PAYABLE: 'Карыз таанылды (заказ)',
  PAYMENT: 'Төлөм',
  PREPAYMENT: 'Аванс',
  PREPAYMENT_APPLY: 'Аванс эсептелди',
  RECEIVABLE: 'Поставщик бизге карыз',
  RECEIVABLE_CLOSE: 'Поставщиктин карызы жабылды',
  WRITEOFF: 'Эсептен чыгаруу',
};

export function SupplierListPage() {
  const { data, error, loading } = useApi<Supplier[]>('/suppliers');
  const { hasRole } = useAuth();

  return (
    <Page
      title="Поставщиктер"
      actions={
        hasRole('OWNER') ? (
          <Link to="/supplier-payments/new">
            <button className="secondary">Төлөм</button>
          </Link>
        ) : null
      }
    >
      <ErrorBanner message={error} />
      {loading && <Loading />}
      {data && data.length === 0 && <Empty text="Поставщик жок." />}
      {(data ?? []).map((supplier) => (
        <Link
          key={supplier.id}
          to={`/suppliers/${supplier.id}`}
          className="card card-link"
        >
          <div className="row">
            <strong>{supplier.name}</strong>
            {!supplier.is_active && <span className="badge neutral">Активдүү эмес</span>}
          </div>
          {supplier.contact && <span className="muted">{supplier.contact}</span>}
        </Link>
      ))}
    </Page>
  );
}

export function SupplierPage() {
  const { id = '' } = useParams();
  const { hasRole } = useAuth();

  const supplier = useApi<Supplier>(`/suppliers/${id}`);
  const ledger = useApi<SupplierLedger>(
    hasRole('OWNER') ? `/suppliers/${id}/ledger` : null,
  );
  const purchases = useApi<PurchaseListItem[]>(
    `/purchase-board?supplier_id=${id}`,
  );

  if (supplier.loading) {
    return <Page title="Поставщик" back="/suppliers"><Loading /></Page>;
  }
  if (supplier.error || !supplier.data) {
    return (
      <Page title="Поставщик" back="/suppliers">
        <ErrorBanner message={supplier.error ?? 'Табылган жок'} />
      </Page>
    );
  }

  return (
    <Page title={supplier.data.name} back="/suppliers">
      {ledger.data && (
        <div className="card">
          <div className="row">
            <span className="muted">Баланс</span>
            <Money value={ledger.data.balance_cny} currency="CNY" className="big" />
          </div>
          {ledger.data.we_owe_cny !== '0.00' && (
            <p className="banner warn">
              Биз карызбыз:{' '}
              <Money value={ledger.data.we_owe_cny} currency="CNY" />
            </p>
          )}
        </div>
      )}

      <div className="card">
        {supplier.data.contact && (
          <div className="row">
            <span className="muted">Байланыш</span>
            <span>{supplier.data.contact}</span>
          </div>
        )}
        {!supplier.data.is_active && (
          <span className="badge neutral">Активдүү эмес</span>
        )}
        {hasRole('OWNER') && (
          <Link to={`/supplier-payments/new?supplier_id=${id}`}>
            <button style={{ width: '100%' }}>Төлөм жасоо (SPY)</button>
          </Link>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Заказдар</h3>
        {(purchases.data ?? []).length === 0 && <p className="muted">Заказ жок.</p>}
        <div className="lines">
          {(purchases.data ?? []).map((purchase) => (
            <Link
              key={purchase.document_id}
              to={`/purchases/${purchase.document_id}`}
              className="line card-link"
            >
              <div>
                <div>{purchase.doc_number}</div>
                <div className="inline">
                  <LogisticsBadge status={purchase.logistics_status} />
                  <PaymentBadge status={purchase.payment_status} />
                </div>
              </div>
              <Money value={purchase.total_cny} currency="CNY" />
            </Link>
          ))}
        </div>
      </div>

      {hasRole('OWNER') && (
        <div className="card">
          <h3 className="section-title">Ledger (§4.3)</h3>
          <ErrorBanner message={ledger.error} />
          {ledger.loading && <Loading />}
          {ledger.data && ledger.data.entries.length === 0 && (
            <p className="muted">Жазуу жок.</p>
          )}
          <div className="lines">
            {(ledger.data?.entries ?? []).map((entry) => (
              <div className="line" key={entry.id}>
                <div>
                  <div>{ENTRY_LABEL[entry.entry_type] ?? entry.entry_type}</div>
                  <div className="muted">{entry.created_at.slice(0, 10)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Money value={entry.amount_cny} currency="CNY" />
                  {entry.kgs_value && (
                    <div className="muted">
                      <Money value={entry.kgs_value} currency="KGS" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Минус = биз карызбыз, плюс = аванс же поставщиктин карызы.
          </p>
        </div>
      )}
    </Page>
  );
}
