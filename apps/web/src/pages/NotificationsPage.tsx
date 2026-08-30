import { useState } from 'react';
import { ApiError, api } from '../api/client';
import type { NotificationList } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

const KIND_LABEL: Record<string, string> = {
  SUPPLIER_DEBT: 'Поставщик карызы',
  CARGO_DEBT: 'Карго карызы',
  LOW_CURRENCY_BALANCE: 'Валюта кассасы',
};

/** In-app alerts (§39). */
export function NotificationsPage() {
  const { hasRole } = useAuth();
  const { data, error, loading, reload } = useApi<NotificationList>('/notifications');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(path: string) {
    setBusy(true);
    setActionError(null);
    try {
      await api(path, { method: 'POST' });
      reload();
    } catch (e: unknown) {
      setActionError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Эскертүүлөр"
      actions={
        hasRole('OWNER') ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => run('/notifications/run-digest')}
          >
            Текшерүү
          </button>
        ) : null
      }
    >
      <ErrorBanner message={error ?? actionError} />
      {loading && <Loading />}

      {data && data.unread_count > 0 && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => run('/notifications/read-all')}
        >
          Баарын окулду деп белгилөө ({data.unread_count})
        </button>
      )}

      {data && data.items.length === 0 && <Empty text="Эскертүү жок." />}

      {(data?.items ?? []).map((item) => (
        <div
          className="card"
          key={item.id}
          style={item.read_at ? { opacity: 0.6 } : undefined}
        >
          <div className="row">
            <strong>{item.title}</strong>
            {!item.read_at && <span className="badge danger">Жаңы</span>}
          </div>
          <span className="badge neutral">{KIND_LABEL[item.kind] ?? item.kind}</span>
          <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{item.body}</p>
          <div className="row">
            <span className="muted">{item.created_at.slice(0, 10)}</span>
            {!item.read_at && (
              <button
                className="link"
                disabled={busy}
                onClick={() => run(`/notifications/${item.id}/read`)}
              >
                Окулду
              </button>
            )}
          </div>
        </div>
      ))}
    </Page>
  );
}
