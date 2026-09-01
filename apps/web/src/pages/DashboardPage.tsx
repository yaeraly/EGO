import { Link } from 'react-router-dom';
import type { Dashboard } from '../api/types';
import { Money } from '../components/Money';
import { ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * The OWNER's one screen (§32).
 *
 * Everything here is a summary of a report that exists in full elsewhere, so
 * each block links to the screen that explains it. Nothing is recalculated:
 * the figures come from the same services the statements use.
 */
export function DashboardPage() {
  const view = useApi<Dashboard>('/reports/dashboard');
  const data = view.data;

  return (
    <Page title="Кыскача абал">
      {view.loading && <Loading />}
      <ErrorBanner message={view.error} />
      {data && (
        <>
          <div className="card">
            <div className="row">
              <span className="muted">{data.as_of}</span>
              {data.business_plan_pct && (
                <span
                  className={`badge ${
                    Number(data.business_plan_pct) >= 100 ? 'ok' : 'warn'
                  }`}
                >
                  план {data.business_plan_pct}%
                </span>
              )}
            </div>
            <div className="row">
              <span>Бүгүнкү сатуу ({data.today.sales})</span>
              <strong>
                <Money value={data.today.revenue} currency="KGS" />
              </strong>
            </div>
            <div className="row">
              <span className="muted">бүгүнкү пайда</span>
              <span className="muted">{data.today.profit}</span>
            </div>
            <div className="row">
              <span>Ушул айда ({data.month.sales})</span>
              <strong>
                <Money value={data.month.revenue} currency="KGS" />
              </strong>
            </div>
            <div className="row">
              <span className="muted">айлык пайда</span>
              <span className="muted">{data.month.profit}</span>
            </div>
          </div>

          <Link className="card card-link" to="/health">
            <div className="row">
              <strong>🩺 Эмне кылуу керек</strong>
              <span className="muted">күнүмдүк тизме (§34)</span>
            </div>
          </Link>

          <Link className="card card-link" to="/accounts">
            <div className="row">
              <strong>💰 Касса жана банк</strong>
              <Money value={data.cash.total_kgs} currency="KGS" />
            </div>
            {data.cash.by_currency.map((line) => (
              <div className="row" key={line.currency}>
                <span className="muted">
                  {line.currency}
                  {line.currency !== 'KGS' ? ` · ${line.amount}` : ''}
                </span>
                <span className="muted">{line.kgs}</span>
              </div>
            ))}
            <div className="row">
              <span className="muted">сатуучулардын колунда</span>
              <span className="muted">{data.cash.with_sellers_kgs}</span>
            </div>
          </Link>

          <Link className="card card-link" to="/customers">
            <div className="row">
              <strong>👤 Кардарлар</strong>
              <Money value={data.customers.receivables} currency="KGS" />
            </div>
            <div className="row">
              <span
                className={
                  Number(data.customers.overdue) > 0 ? undefined : 'muted'
                }
              >
                мөөнөтү өткөн ({data.customers.overdue_count})
              </span>
              {Number(data.customers.overdue) > 0 ? (
                <span className="badge warn">{data.customers.overdue}</span>
              ) : (
                <span className="muted">{data.customers.overdue}</span>
              )}
            </div>
            <div className="row">
              <span className="muted">кардарлардын авансы (§17-А.5)</span>
              <span className="muted">{data.customers.advances}</span>
            </div>
          </Link>

          <Link className="card card-link" to="/suppliers">
            <div className="row">
              <strong>🏭 Кытайдагы карыз</strong>
              <span>{data.suppliers.payable_cny} CNY</span>
            </div>
            <div className="row">
              <span className="muted">сом эквиваленти</span>
              <span className="muted">{data.suppliers.payable_kgs}</span>
            </div>
            <div className="row">
              <span className="muted">карго карызы</span>
              <span className="muted">
                {data.suppliers.cargo_payable_usd} USD ·{' '}
                {data.suppliers.cargo_payable_kgs}
              </span>
            </div>
            <div className="row">
              <span className="muted">
                ачык талаптар ({data.suppliers.open_claims_count})
              </span>
              <span className="muted">{data.suppliers.open_claims}</span>
            </div>
          </Link>

          <Link className="card card-link" to="/stock">
            <div className="row">
              <strong>🏬 Склад</strong>
              <Money value={data.stock.value_kgs} currency="KGS" />
            </div>
            <div className="row">
              <span className="muted">{data.stock.qty} даана</span>
              <span className="muted">
                сатылуучу {data.stock.main_value_kgs} · брак{' '}
                {data.stock.defect_value_kgs}
              </span>
            </div>
          </Link>

          {data.stock.low_count > 0 && (
            <Link className="card card-link" to="/analytics">
              <div className="row">
                <strong>⚠️ Аз калган товарлар</strong>
                <span className="badge warn">{data.stock.low_count}</span>
              </div>
              {data.stock.low.map((product) => (
                <div className="row" key={product.product_id}>
                  <span className="muted">{product.name}</span>
                  <span className="muted">
                    калдык {product.available} · жолдо {product.inbound}
                  </span>
                </div>
              ))}
            </Link>
          )}

          {data.top_selling.length > 0 && (
            <Link className="card card-link" to="/analytics">
              <h3 className="section-title">Эң көп сатылганы (ушул айда)</h3>
              {data.top_selling.map((product) => (
                <div className="row" key={product.product_id}>
                  <span className="muted">
                    {product.name} · {product.qty} даана
                  </span>
                  <span className="muted">{product.revenue}</span>
                </div>
              ))}
              <h3 className="section-title">Эң пайдалуусу</h3>
              {data.most_profitable.map((product) => (
                <div className="row" key={product.product_id}>
                  <span className="muted">{product.name}</span>
                  <span className="muted">
                    маржа {product.margin}
                    {product.margin_pct ? ` · ${product.margin_pct}%` : ''}
                  </span>
                </div>
              ))}
            </Link>
          )}

          {data.sellers.length > 0 && (
            <Link className="card card-link" to="/performance">
              <h3 className="section-title">Сатуучулар (ушул айда)</h3>
              {data.sellers.map((seller) => (
                <div className="row" key={seller.user_id}>
                  <span>
                    {seller.full_name}
                    <span className="muted"> · {seller.sales} сатуу</span>
                  </span>
                  <span className="inline">
                    <span className="muted">маржа {seller.margin}</span>
                    {seller.plan_pct && (
                      <span
                        className={`badge ${
                          Number(seller.plan_pct) >= 100 ? 'ok' : 'warn'
                        }`}
                      >
                        {seller.plan_pct}%
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </Link>
          )}

          <Link className="card card-link" to="/reports">
            <div className="row">
              <strong>📊 Толук отчеттор</strong>
              <span className="muted">ОПУ · ДДС · Баланс (§28)</span>
            </div>
          </Link>
        </>
      )}
    </Page>
  );
}
