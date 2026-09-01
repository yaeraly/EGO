import { Link } from 'react-router-dom';
import type { HealthReport } from '../api/types';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * What needs doing (§34).
 *
 * The dashboard says how the business stands; this says what stands in need
 * of attention. Every card names the thing to do and links to where it is
 * done — §34's point is that the system should show the OWNER what to do,
 * not merely what is true.
 */
const SEVERITY: Record<string, { label: string; tone: string }> = {
  URGENT: { label: 'Шашылыш', tone: 'warn' },
  WARNING: { label: 'Көңүл буруу', tone: 'warn' },
  INFO: { label: 'Маалымат', tone: 'neutral' },
};

export function HealthPage() {
  const report = useApi<HealthReport>('/reports/health');
  const data = report.data;

  return (
    <Page title="Эмне кылуу керек (§34)">
      {report.loading && <Loading />}
      <ErrorBanner message={report.error} />

      {data && (
        <div className="card">
          <div className="row">
            <span className="muted">{data.as_of}</span>
            <span className="muted">
              ай {data.month_progress_pct}% өттү
            </span>
          </div>
          <div className="row">
            <span>Шашылыш</span>
            <span className={`badge ${data.counts.urgent > 0 ? 'warn' : 'ok'}`}>
              {data.counts.urgent}
            </span>
          </div>
          <div className="row">
            <span className="muted">Көңүл буруу</span>
            <span className="muted">{data.counts.warning}</span>
          </div>
          <div className="row">
            <span className="muted">Маалымат</span>
            <span className="muted">{data.counts.info}</span>
          </div>
        </div>
      )}

      {data && data.items.length === 0 && (
        <Empty text="Бүгүн көңүл бурчу нерсе жок. Баары тартипте." />
      )}

      {(data?.items ?? []).map((item, index) => (
        <Link
          className="card card-link"
          key={`${item.kind}-${index}`}
          to={item.link}
        >
          <div className="row">
            <strong>{item.title}</strong>
            <span className={`badge ${SEVERITY[item.severity].tone}`}>
              {SEVERITY[item.severity].label}
            </span>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {item.detail}
          </p>
          {item.amount && (
            <div className="row">
              <span className="muted">
                {item.count > 1 ? `${item.count} позиция` : ''}
              </span>
              {item.currency === 'KGS' ? (
                <Money value={item.amount} currency="KGS" />
              ) : (
                <strong>
                  {item.amount} {item.currency}
                </strong>
              )}
            </div>
          )}
        </Link>
      ))}
    </Page>
  );
}
