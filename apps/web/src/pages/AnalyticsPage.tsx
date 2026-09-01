import { useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  ProductAnalysisReport,
  ReorderReport,
  SalesTrendReport,
} from '../api/types';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * The analytical reports (§29).
 *
 * ABC and XYZ are read together: one says how much a product is worth, the
 * other how predictable it is. A steady, valuable product is worth a standing
 * order; an erratic, cheap one is worth ordering when somebody asks.
 */
type Tab = 'products' | 'trend' | 'reorder';

const TABS: { id: Tab; label: string }[] = [
  { id: 'products', label: 'Товарлар' },
  { id: 'trend', label: 'Динамика' },
  { id: 'reorder', label: 'Заказ' },
];

function monthsAgo(count: number): string {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - count);
  return date.toISOString().slice(0, 10);
}

export function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('products');
  const [from, setFrom] = useState(monthsAgo(6));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  return (
    <Page title="Аналитика (§29)">
      <div className="card">
        <div className="inline">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={tab === entry.id ? '' : 'secondary'}
              style={{ flex: 1 }}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {tab !== 'reorder' && (
          <div className="inline">
            <label style={{ flex: 1 }}>
              Башталышы
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label style={{ flex: 1 }}>
              Аягы
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}
      </div>

      {tab === 'products' && <Products from={from} to={to} />}
      {tab === 'trend' && <Trend from={from} to={to} />}
      {tab === 'reorder' && <Reorder />}
    </Page>
  );
}

const ABC_TONE: Record<string, string> = { A: 'ok', B: 'neutral', C: 'warn' };
const XYZ_HINT: Record<string, string> = {
  X: 'туруктуу суроо-талап',
  Y: 'орточо туруксуз',
  Z: 'туруксуз',
};

function Products({ from, to }: { from: string; to: string }) {
  const report = useApi<ProductAnalysisReport>(
    `/reports/products?from=${from}&to=${to}`,
  );
  const data = report.data;

  return (
    <>
      {report.loading && <Loading />}
      <ErrorBanner message={report.error} />
      {data && data.products.length === 0 && (
        <Empty text="Бул мезгилде сатуу жок." />
      )}
      {data && data.products.length > 0 && (
        <>
          <div className="card">
            <div className="row">
              <span>Сатуу</span>
              <strong>
                <Money value={data.totals.revenue} currency="KGS" />
              </strong>
            </div>
            <div className="row">
              <span className="muted">Өздүк нарк</span>
              <span className="muted">{data.totals.cogs}</span>
            </div>
            <div className="row">
              <span>Маржа</span>
              <strong>
                <Money value={data.totals.margin} currency="KGS" />
              </strong>
            </div>
            {data.totals.margin_pct && (
              <div className="row">
                <span className="muted">Маржа үлүшү</span>
                <span className="muted">{data.totals.margin_pct}%</span>
              </div>
            )}
          </div>

          {data.products.map((product) => (
            <Link
              className="card card-link"
              key={product.product_id}
              to={`/products/${product.product_id}`}
            >
              <div className="row">
                <strong>{product.name}</strong>
                <span className="inline">
                  <span className={`badge ${ABC_TONE[product.abc]}`}>
                    {product.abc}
                  </span>
                  {product.xyz && (
                    <span className="badge neutral">{product.xyz}</span>
                  )}
                </span>
              </div>
              <div className="row">
                <span className="muted">
                  {product.sku} · {product.qty} даана · {product.sales} сатуу
                </span>
                <Money value={product.revenue} currency="KGS" />
              </div>
              <div className="row">
                <span className="muted">
                  маржа {product.margin}
                  {product.margin_pct ? ` · ${product.margin_pct}%` : ''}
                </span>
                <span className="muted">
                  үлүшү {product.share_pct}% · чогуу {product.cumulative_pct}%
                </span>
              </div>
              {product.xyz ? (
                <span className="muted">
                  Суроо-талаптын термелүүсү {product.variation_pct}% —{' '}
                  {XYZ_HINT[product.xyz]} ({product.months} ай)
                </span>
              ) : (
                <span className="muted">
                  XYZ үчүн маалымат жетишсиз ({product.months} ай)
                </span>
              )}
            </Link>
          ))}

          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              ABC: A — жалпы сатуунун {data.thresholds.abc_a_pct}%ына чейинки
              товарлар, B — {data.thresholds.abc_b_pct}%ка чейин, калганы C.
              XYZ: термелүү {data.thresholds.xyz_x_pct}%ка чейин — X,{' '}
              {data.thresholds.xyz_y_pct}%ка чейин — Y, андан жогору — Z.
              Бул чектер жалпы кабыл алынган демейкилер — билим базада сан
              жазылган эмес, каалаган учурда өзгөртсө болот.
            </p>
          </div>
        </>
      )}
    </>
  );
}

function Trend({ from, to }: { from: string; to: string }) {
  const [bucket, setBucket] = useState<'day' | 'week' | 'month'>('day');
  const report = useApi<SalesTrendReport>(
    `/reports/sales-trend?bucket=${bucket}&from=${from}&to=${to}`,
  );
  const data = report.data;
  const peak = Math.max(
    1,
    ...(data?.points ?? []).map((point) => Number(point.revenue)),
  );

  return (
    <>
      <div className="card">
        <div className="inline">
          {(['day', 'week', 'month'] as const).map((unit) => (
            <button
              key={unit}
              type="button"
              className={bucket === unit ? '' : 'secondary'}
              style={{ flex: 1 }}
              onClick={() => setBucket(unit)}
            >
              {unit === 'day' ? 'Күн' : unit === 'week' ? 'Апта' : 'Ай'}
            </button>
          ))}
        </div>
      </div>

      {report.loading && <Loading />}
      <ErrorBanner message={report.error} />
      {data && data.points.length === 0 && (
        <Empty text="Бул мезгилде сатуу жок." />
      )}
      {(data?.points ?? []).map((point) => (
        <div className="card" key={point.bucket}>
          <div className="row">
            <strong>{point.bucket}</strong>
            <Money value={point.revenue} currency="KGS" />
          </div>
          <div
            aria-hidden
            style={{
              height: 6,
              borderRadius: 3,
              background: 'var(--accent, #2563eb)',
              width: `${(Number(point.revenue) / peak) * 100}%`,
              minWidth: 2,
            }}
          />
          <div className="row">
            <span className="muted">{point.sales} сатуу</span>
            <span className="muted">маржа {point.margin}</span>
          </div>
        </div>
      ))}
    </>
  );
}

function Reorder() {
  const report = useApi<ReorderReport>('/reports/reorder');
  const data = report.data;

  return (
    <>
      {report.loading && <Loading />}
      <ErrorBanner message={report.error} />
      {data && data.products.length === 0 && (
        <Empty text="Заказ кылуу керек болгон товар жок." />
      )}
      {(data?.products ?? []).map((product) => (
        <Link
          className="card card-link"
          key={product.product_id}
          to={`/products/${product.product_id}`}
        >
          <div className="row">
            <strong>{product.name}</strong>
            <span
              className={`badge ${
                product.reason === 'BELOW_MINIMUM' ? 'warn' : 'neutral'
              }`}
            >
              {product.reason === 'BELOW_MINIMUM'
                ? 'минимумдан төмөн'
                : 'заказ чекитинде'}
            </span>
          </div>
          <div className="row">
            <span className="muted">{product.sku}</span>
            <span className="muted">
              калдык {product.available} (складда {product.on_hand}, бронь{' '}
              {product.reserved})
            </span>
          </div>
          <div className="row">
            <span className="muted">
              мин {product.min_stock} · заказ чекити {product.reorder_point}
            </span>
            <span className="muted">
              жолдо {product.inbound} · {data?.window_days} күндө сатылганы{' '}
              {product.sold_recently}
            </span>
          </div>
        </Link>
      ))}
      {data && data.products.length > 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Калдык — бош калдык: бронь коюлган товар башка кардардыкы (§17).
            Жолдогу товар кемитилбейт — ал жетеби же жокпу, жеткирүү мөөнөтүн
            билген сатып алуучу чечет.
          </p>
        </div>
      )}
    </>
  );
}
