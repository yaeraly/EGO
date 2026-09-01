import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type {
  CustomerReport,
  PlanView,
  SellerReport,
  UserSummary,
} from '../api/types';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * Who sells and who buys (§24, §30, §31).
 *
 * The plan sits beside the result, never inside it: a percentage means
 * nothing without both numbers in view, and a month nobody set a target for
 * shows the result and no percentage at all.
 */
type Tab = 'sellers' | 'customers' | 'plans';

const TABS: { id: Tab; label: string }[] = [
  { id: 'sellers', label: 'Сатуучулар' },
  { id: 'customers', label: 'Кардарлар' },
  { id: 'plans', label: 'План' },
];

function monthStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function PerformancePage() {
  const [tab, setTab] = useState<Tab>('sellers');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  return (
    <Page title="Сатуучулар жана кардарлар">
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
        {tab !== 'plans' && (
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

      {tab === 'sellers' && <Sellers from={from} to={to} />}
      {tab === 'customers' && <Customers from={from} to={to} />}
      {tab === 'plans' && <Plans />}
    </Page>
  );
}

function Achievement({
  label,
  actual,
  target,
  pct,
}: {
  label: string;
  actual: string;
  target: string | null;
  pct: string | null;
}) {
  return (
    <>
      <div className="row">
        <span>{label}</span>
        <strong>
          <Money value={actual} currency="KGS" />
        </strong>
      </div>
      {target && (
        <>
          <div className="row">
            <span className="muted">план {target}</span>
            <span className={`badge ${Number(pct) >= 100 ? 'ok' : 'warn'}`}>
              {pct}%
            </span>
          </div>
          <div
            aria-hidden
            style={{
              height: 6,
              borderRadius: 3,
              background: 'var(--accent, #2563eb)',
              width: `${Math.min(100, Number(pct ?? 0))}%`,
              minWidth: 2,
            }}
          />
        </>
      )}
    </>
  );
}

function Sellers({ from, to }: { from: string; to: string }) {
  const report = useApi<SellerReport>(`/reports/sellers?from=${from}&to=${to}`);
  const data = report.data;

  return (
    <>
      {report.loading && <Loading />}
      <ErrorBanner message={report.error} />
      {data && (
        <div className="card">
          <h3 className="section-title">Бүтүндөй бизнес (§24)</h3>
          <Achievement
            label={`Сатуу (${data.totals.sales})`}
            actual={data.totals.revenue}
            target={data.business_plan?.revenue_target ?? null}
            pct={data.business_achievement.revenue_pct}
          />
          <Achievement
            label="Маржа"
            actual={data.totals.margin}
            target={data.business_plan?.margin_target ?? null}
            pct={data.business_achievement.margin_pct}
          />
          <div className="row">
            <span className="muted">Жаңы кардарлар</span>
            <span className="muted">
              {data.totals.new_customers}
              {data.business_plan?.new_customers_target
                ? ` / ${data.business_plan.new_customers_target} (${data.business_achievement.new_customers_pct}%)`
                : ''}
            </span>
          </div>
          {!data.business_plan && (
            <p className="muted" style={{ margin: 0 }}>
              Бул айга план коюлган эмес — «План» табынан коюңуз.
            </p>
          )}
        </div>
      )}

      {data && data.sellers.length === 0 && (
        <Empty text="Бул мезгилде сатуу жок." />
      )}

      {(data?.sellers ?? []).map((seller) => (
        <div className="card" key={seller.user_id}>
          <div className="row">
            <strong>{seller.full_name}</strong>
            <Money value={seller.revenue} currency="KGS" />
          </div>
          <Achievement
            label={`Сатуу (${seller.sales})`}
            actual={seller.revenue}
            target={seller.plan?.revenue_target ?? null}
            pct={seller.achievement.revenue_pct}
          />
          <div className="row">
            <span className="muted">
              маржа {seller.margin}
              {seller.margin_pct ? ` · ${seller.margin_pct}%` : ''}
            </span>
            <span className="muted">
              орточо чек {seller.average_sale ?? '—'}
            </span>
          </div>
          <div className="row">
            <span className="muted">
              карызга {seller.credit_sales} сатуу · {seller.credit_revenue}
            </span>
            <span className="muted">
              жаңы кардар {seller.new_customers}
              {seller.plan?.new_customers_target
                ? ` / ${seller.plan.new_customers_target}`
                : ''}
            </span>
          </div>
          {seller.accounts.map((account) => (
            <div className="row" key={account.name}>
              <span className="muted">{account.name}</span>
              <span className="muted">
                {account.balance} {account.currency}
              </span>
            </div>
          ))}
          {Object.keys(seller.bonus).length > 0 && (
            <div className="row">
              <span className="muted">бонус (§23)</span>
              <span className="muted">
                {Object.entries(seller.bonus)
                  .map(([status, amount]) => `${status} ${amount}`)
                  .join(' · ')}
              </span>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function Customers({ from, to }: { from: string; to: string }) {
  const report = useApi<CustomerReport>(`/reports/customers?from=${from}&to=${to}`);
  const data = report.data;

  return (
    <>
      {report.loading && <Loading />}
      <ErrorBanner message={report.error} />
      {data && data.customers.length === 0 && (
        <Empty text="Бул мезгилде катталган кардарга сатуу жок." />
      )}

      {data && data.lapsed.length > 0 && (
        <div className="card">
          <h3 className="section-title">
            Кайрылбай калгандар ({data.lapsed_since} тартып)
          </h3>
          {data.lapsed.map((customer) => (
            <Link
              className="row"
              key={customer.customer_id}
              to={`/customers/${customer.customer_id}`}
            >
              <span>
                {customer.name}
                <span className="muted">
                  {' '}
                  · {customer.phone ?? 'телефон жок'}
                </span>
              </span>
              <span className="muted">
                {customer.purchases} сатып алуу · акыркысы{' '}
                {customer.last_purchase}
              </span>
            </Link>
          ))}
          <p className="muted" style={{ margin: 0 }}>
            Мурда кеминде эки жолу сатып алган, бирок бул мөөнөттө көрүнбөгөн
            кардарлар — бир жолу келип кеткендер бул тизмеде жок.
          </p>
        </div>
      )}

      {(data?.customers ?? []).map((customer) => (
        <Link
          className="card card-link"
          key={customer.customer_id}
          to={`/customers/${customer.customer_id}`}
        >
          <div className="row">
            <strong>{customer.name}</strong>
            <Money value={customer.revenue} currency="KGS" />
          </div>
          <div className="row">
            <span className="muted">
              {customer.ctype} · {customer.category} · {customer.purchases} сатып
              алуу
            </span>
            <span className="muted">
              маржа {customer.margin}
              {customer.margin_pct ? ` · ${customer.margin_pct}%` : ''}
            </span>
          </div>
          <div className="row">
            <span className="muted">
              карызы {customer.debt} · акыркысы {customer.last_purchase ?? '—'}
            </span>
            <span className="muted">
              {customer.frequency_days
                ? `ар ${customer.frequency_days} күндө`
                : 'жыштыгы белгисиз'}
            </span>
          </div>
          {Object.keys(customer.reservations).length > 0 && (
            <span className="muted">
              бронь:{' '}
              {Object.entries(customer.reservations)
                .map(([status, count]) => `${status} ${count}`)
                .join(' · ')}
            </span>
          )}
        </Link>
      ))}
    </>
  );
}

function Plans() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);

  const plans = useApi<PlanView[]>(`/plans?year=${year}&month=${month}`);
  const users = useApi<UserSummary[]>('/users');

  const [userId, setUserId] = useState('');
  const [revenue, setRevenue] = useState('');
  const [margin, setMargin] = useState('');
  const [newCustomers, setNewCustomers] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/plans', {
        method: 'PUT',
        body: {
          period_year: year,
          period_month: month,
          ...(userId ? { user_id: userId } : {}),
          ...(revenue.trim() ? { revenue_target: revenue.trim() } : {}),
          ...(margin.trim() ? { margin_target: margin.trim() } : {}),
          ...(newCustomers.trim()
            ? { new_customers_target: Number(newCustomers) }
            : {}),
        },
      });
      setRevenue('');
      setMargin('');
      setNewCustomers('');
      plans.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api(`/plans/${id}`, { method: 'DELETE' });
    plans.reload();
  }

  return (
    <>
      <div className="card">
        <div className="inline">
          <label style={{ flex: 1 }}>
            Жыл
            <input
              value={String(year)}
              inputMode="numeric"
              onChange={(e) => setYear(Number(e.target.value) || year)}
            />
          </label>
          <label style={{ flex: 1 }}>
            Ай
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((value) => (
                <option key={value} value={value}>
                  {String(value).padStart(2, '0')}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <form className="card" onSubmit={submit}>
        <h3 className="section-title">План коюу (§24)</h3>
        <ErrorBanner message={error} />
        <label>
          Кимге
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Бүтүндөй бизнес</option>
            {(users.data ?? [])
              .filter((user) => user.status === 'ACTIVE')
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name}
                </option>
              ))}
          </select>
        </label>
        <div className="inline">
          <label style={{ flex: 1 }}>
            Сатуу планы
            <input
              value={revenue}
              inputMode="decimal"
              placeholder="0.00"
              onChange={(e) => setRevenue(e.target.value)}
            />
          </label>
          <label style={{ flex: 1 }}>
            Маржа планы
            <input
              value={margin}
              inputMode="decimal"
              placeholder="0.00"
              onChange={(e) => setMargin(e.target.value)}
            />
          </label>
        </div>
        <label>
          Жаңы кардар планы
          <input
            value={newCustomers}
            inputMode="numeric"
            placeholder="0"
            onChange={(e) => setNewCustomers(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={
            busy || (!revenue.trim() && !margin.trim() && !newCustomers.trim())
          }
        >
          {busy ? 'Сакталууда…' : 'Планды сактоо'}
        </button>
        <p className="muted" style={{ margin: 0 }}>
          Коюлбаган максат — «план жок» дегени, «0» эмес: отчетто ага пайыз
          көрсөтүлбөйт.
        </p>
      </form>

      {plans.loading && <Loading />}
      <ErrorBanner message={plans.error} />
      {plans.data?.length === 0 && <Empty text="Бул айга план коюлган эмес." />}
      {(plans.data ?? []).map((plan) => (
        <div className="card" key={plan.id}>
          <div className="row">
            <strong>{plan.full_name ?? 'Бүтүндөй бизнес'}</strong>
            <button type="button" className="secondary" onClick={() => remove(plan.id)}>
              Өчүрүү
            </button>
          </div>
          <div className="row">
            <span className="muted">сатуу</span>
            <span className="muted">{plan.revenue_target ?? '—'}</span>
          </div>
          <div className="row">
            <span className="muted">маржа</span>
            <span className="muted">{plan.margin_target ?? '—'}</span>
          </div>
          <div className="row">
            <span className="muted">жаңы кардар</span>
            <span className="muted">{plan.new_customers_target ?? '—'}</span>
          </div>
        </div>
      ))}
    </>
  );
}
