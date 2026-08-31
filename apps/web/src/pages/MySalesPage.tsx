import { Link } from 'react-router-dom';
import type { AccountBalance, SaleListItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/** "Менин сатууларым" and "Менин кассаларым" (§2, §19). */
export function MySalesPage() {
  const { user } = useAuth();
  const sales = useApi<SaleListItem[]>('/sales?mine=true');
  const accounts = useApi<AccountBalance[]>('/accounts/balances');

  // §19 gives each person their own accounts, and the account row says whose
  // it is — matching on the name would break the moment two people share one.
  const mine = (accounts.data ?? []).filter(
    (account) => account.owner_user === user?.id,
  );

  return (
    <Page title="Менин сатууларым">
      {mine.length > 0 && (
        <div className="card">
          <h3 className="section-title">Менин кассаларым (§19)</h3>
          {mine.map((account) => (
            <div className="row" key={account.account_id}>
              <span>{account.name}</span>
              <Money value={account.balance} currency={account.currency} />
            </div>
          ))}
        </div>
      )}

      <ErrorBanner message={sales.error} />
      {sales.loading && <Loading />}
      {sales.data?.length === 0 && <Empty text="Сатуу жок." />}

      {(sales.data ?? []).map((sale) => {
        const document = sale.documents_sales_document_idTodocuments;
        return (
          <Link
            key={sale.document_id}
            to={`/sell/${sale.document_id}`}
            className="card card-link"
          >
            <div className="row">
              <strong>{document.doc_number}</strong>
              <Money value={sale.total_amount} currency="KGS" />
            </div>
            <div className="row">
              <span className="muted">{sale.customers.name}</span>
              <span className="muted">{document.business_date.slice(0, 10)}</span>
            </div>
            <div className="inline">
              <span
                className={`badge ${document.status === 'CONFIRMED' ? 'ok' : 'neutral'}`}
              >
                {document.status === 'CONFIRMED' ? 'Тастыкталды' : 'Черновик'}
              </span>
              {sale.is_loss_sale && <span className="badge danger">LSS</span>}
              {sale.debt_status === 'OPEN' && (
                <span className="badge warn">Карыз</span>
              )}
              {sale.debt_status === 'PARTIALLY_PAID' && (
                <span className="badge warn">Жарым-жартылай</span>
              )}
            </div>
          </Link>
        );
      })}
    </Page>
  );
}

/** The OWNER's queue of discounts waiting on a decision (§13.5). */
export function ApprovalsPage() {
  const sales = useApi<SaleListItem[]>('/sales?status=DRAFT');

  return (
    <Page title="Бекитүүлөр">
      <ErrorBanner message={sales.error} />
      {sales.loading && <Loading />}
      <p className="muted">
        Скидка кызматкердин лимитинен ашса, сатуу ушул жерде бекитилет. Өздүк
        нарктан төмөн сатууга бекитүү да жол бербейт (§13.4).
      </p>
      {(sales.data ?? []).map((sale) => (
        <Link
          key={sale.document_id}
          to={`/sell/${sale.document_id}`}
          className="card card-link"
        >
          <div className="row">
            <strong>{sale.documents_sales_document_idTodocuments.doc_number}</strong>
            <Money value={sale.total_amount} currency="KGS" />
          </div>
          <span className="muted">{sale.customers.name}</span>
        </Link>
      ))}
    </Page>
  );
}
