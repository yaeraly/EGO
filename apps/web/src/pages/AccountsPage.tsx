import { Link } from 'react-router-dom';
import type { AccountBalance } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/** Every till and what is in it. Balance is always SUM(movements) (§27). */
export function AccountsPage() {
  const { data, error, loading } = useApi<AccountBalance[]>('/accounts/balances');
  const { hasRole } = useAuth();

  return (
    <Page
      title="Кассалар"
      actions={
        hasRole('OWNER') ? (
          <Link to="/currency-exchange">
            <button className="secondary">CEX</button>
          </Link>
        ) : null
      }
    >
      <ErrorBanner message={error} />
      {loading && <Loading />}
      {data && data.length === 0 && <Empty text="Касса жок." />}
      {(data ?? []).map((account) => (
        <div className="card" key={account.account_id}>
          <div className="row">
            <strong>{account.name}</strong>
            <Money value={account.balance} currency={account.currency} className="big" />
          </div>
          <div className="inline">
            <span className="badge neutral">{account.type}</span>
            <span className="badge info">{account.currency}</span>
            {!account.is_active && <span className="badge neutral">Жабык</span>}
          </div>
        </div>
      ))}
    </Page>
  );
}
