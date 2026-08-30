import { Link, useParams } from 'react-router-dom';
import type { CargoCompany, CargoLedger } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

const ENTRY_LABEL: Record<string, string> = {
  PAYABLE: 'Карго наркы таанылды',
  PAYMENT: 'Төлөм',
  WRITEOFF: 'Эсептен чыгаруу',
};

export function CargoListPage() {
  const { data, error, loading } = useApi<CargoCompany[]>('/cargo-companies');
  const { hasRole } = useAuth();

  return (
    <Page
      title="Карго компаниялар"
      actions={
        hasRole('OWNER') ? (
          <Link to="/cargo-payments/new">
            <button className="secondary">Төлөм</button>
          </Link>
        ) : null
      }
    >
      <ErrorBanner message={error} />
      {loading && <Loading />}
      {data && data.length === 0 && <Empty text="Карго компания жок." />}
      {(data ?? []).map((company) => (
        <Link key={company.id} to={`/cargo/${company.id}`} className="card card-link">
          <div className="row">
            <strong>{company.name}</strong>
            {!company.is_active && <span className="badge neutral">Активдүү эмес</span>}
          </div>
          {company.contact && <span className="muted">{company.contact}</span>}
        </Link>
      ))}
    </Page>
  );
}

export function CargoPage() {
  const { id = '' } = useParams();
  const { hasRole } = useAuth();

  const company = useApi<CargoCompany>(`/cargo-companies/${id}`);
  const ledger = useApi<CargoLedger>(
    hasRole('OWNER') ? `/cargo-companies/${id}/ledger` : null,
  );

  if (company.loading) {
    return <Page title="Карго" back="/cargo"><Loading /></Page>;
  }
  if (company.error || !company.data) {
    return (
      <Page title="Карго" back="/cargo">
        <ErrorBanner message={company.error ?? 'Табылган жок'} />
      </Page>
    );
  }

  return (
    <Page title={company.data.name} back="/cargo">
      {ledger.data && (
        <div className="card">
          <div className="row">
            <span className="muted">Баланс</span>
            <Money value={ledger.data.balance_usd} currency="USD" className="big" />
          </div>
          {ledger.data.we_owe_usd !== '0.00' && (
            <p className="banner warn">
              Биз карызбыз: <Money value={ledger.data.we_owe_usd} currency="USD" />
            </p>
          )}
          {ledger.data.on_deposit_usd !== '0.00' && (
            <p className="banner info">
              Каргодо депозит:{' '}
              <Money value={ledger.data.on_deposit_usd} currency="USD" />. Приход
              болгондо карго наркы таанылат (Модуль 3, §5.2).
            </p>
          )}
        </div>
      )}

      <div className="card">
        {company.data.contact && (
          <div className="row">
            <span className="muted">Байланыш</span>
            <span>{company.data.contact}</span>
          </div>
        )}
        {hasRole('OWNER') && (
          <Link to={`/cargo-payments/new?cargo_company_id=${id}`}>
            <button style={{ width: '100%' }}>Төлөм жасоо (CPY)</button>
          </Link>
        )}
      </div>

      {hasRole('OWNER') && (
        <div className="card">
          <h3 className="section-title">Ledger (§5.2)</h3>
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
                  <Money value={entry.amount_usd} currency="USD" />
                  {entry.kgs_value && (
                    <div className="muted">
                      <Money value={entry.kgs_value} currency="KGS" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}
