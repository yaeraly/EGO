import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import type {
  AccountBalance,
  SalaryPayment,
  SalaryPeriodRow,
} from '../api/types';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * Salary payments (§25).
 *
 * The parts are shown apart from the total because the total is the only
 * thing handed over and the parts are what explain it — and because §3.1.6
 * insists this is an operating expense, not the owner taking money out.
 */
export function SalariesPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);

  const period = useApi<SalaryPeriodRow[]>(`/salaries/period/${year}/${month}`);
  const payments = useApi<SalaryPayment[]>(`/salaries?year=${year}&month=${month}`);
  const accounts = useApi<AccountBalance[]>('/accounts/balances');

  const [employeeId, setEmployeeId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [base, setBase] = useState('');
  const [bonus, setBonus] = useState('');
  const [advance, setAdvance] = useState('');
  const [deduction, setDeduction] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = (period.data ?? []).find((row) => row.employee_id === employeeId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/salaries', {
        method: 'POST',
        body: {
          employee_id: employeeId,
          period_year: year,
          period_month: month,
          account_id: accountId,
          ...(base.trim() ? { base_amount: base.trim() } : {}),
          ...(bonus.trim() ? { bonus_amount: bonus.trim() } : {}),
          ...(advance.trim() ? { advance_amount: advance.trim() } : {}),
          ...(deduction.trim() ? { deduction: deduction.trim() } : {}),
        },
      });
      await api(`/documents/${document.id}/confirm`, { method: 'POST' });
      setBase('');
      setBonus('');
      setAdvance('');
      setDeduction('');
      period.reload();
      payments.reload();
      accounts.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Айлык (SLR)">
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

      <div className="card">
        <h3 className="section-title">Ушул айда төлөнгөнү (§25)</h3>
        {period.loading && <Loading />}
        {(period.data ?? []).map((row) => (
          <div className="row" key={row.employee_id}>
            <span>
              {row.full_name}
              <span className="muted"> · айлыгы {row.base_salary}</span>
            </span>
            <span className="inline">
              <Money value={row.paid} currency="KGS" />
              {row.payments > 1 && (
                <span className="badge neutral">{row.payments} төлөм</span>
              )}
            </span>
          </div>
        ))}
      </div>

      <form className="card" onSubmit={submit}>
        <h3 className="section-title">Айлык төлөө</h3>
        <ErrorBanner message={error} />

        <label>
          Кызматкер
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            required
          >
            <option value="">—</option>
            {(period.data ?? []).map((row) => (
              <option key={row.employee_id} value={row.employee_id}>
                {row.full_name}
              </option>
            ))}
          </select>
        </label>

        {chosen && chosen.payments > 0 && (
          <p className="banner warn">
            Бул кызматкерге {year}-{String(month).padStart(2, '0')} үчүн{' '}
            {chosen.paid} сом мурда төлөнгөн ({chosen.payments} документ). Кайра
            төлөө тыюу салынган эмес — бирок эки жолу төлөп албаңыз.
          </p>
        )}

        <div className="inline">
          <label style={{ flex: 1 }}>
            Негизги айлык
            <input
              value={base}
              inputMode="decimal"
              placeholder={chosen?.base_salary ?? '0.00'}
              onChange={(e) => setBase(e.target.value)}
            />
          </label>
          <label style={{ flex: 1 }}>
            Бонус (§23)
            <input
              value={bonus}
              inputMode="decimal"
              placeholder="0.00"
              onChange={(e) => setBonus(e.target.value)}
            />
          </label>
        </div>
        <div className="inline">
          <label style={{ flex: 1 }}>
            Аванс
            <input
              value={advance}
              inputMode="decimal"
              placeholder="0.00"
              onChange={(e) => setAdvance(e.target.value)}
            />
          </label>
          <label style={{ flex: 1 }}>
            Кармоо
            <input
              value={deduction}
              inputMode="decimal"
              placeholder="0.00"
              onChange={(e) => setDeduction(e.target.value)}
            />
          </label>
        </div>

        <label>
          Кайсы эсептен төлөнөт
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
          >
            <option value="">—</option>
            {(accounts.data ?? [])
              .filter((account) => account.currency === 'KGS' && account.is_active)
              .map((account) => (
                <option key={account.account_id} value={account.account_id}>
                  {account.name} · {account.balance}
                </option>
              ))}
          </select>
        </label>

        <button type="submit" disabled={busy || !employeeId || !accountId}>
          {busy ? 'Төлөнүүдө…' : 'Айлыкты төлөө'}
        </button>
        <p className="muted" style={{ margin: 0 }}>
          Колго берилчү сумма = негизги + бонус − аванс − кармоо. Айлык —
          операциялык чыгым, ээсинин акча алуусу менен эч качан аралашпайт
          (§25, §3.1.6).
        </p>
      </form>

      <ErrorBanner message={payments.error} />
      {payments.data?.length === 0 && <Empty text="Бул айда төлөм жок." />}

      {(payments.data ?? []).map((payment) => (
        <div className="card" key={payment.document_id}>
          <div className="row">
            <strong>{payment.employee.full_name}</strong>
            <Money value={payment.total_paid} currency="KGS" />
          </div>
          <div className="row">
            <span className="muted">{payment.documents.doc_number}</span>
            <span className="muted">{payment.documents.business_date}</span>
          </div>
          <div className="row">
            <span className="muted">
              {payment.base_amount} + {payment.bonus_amount} − {payment.advance_amount}{' '}
              − {payment.deduction}
            </span>
            <span className="muted">{payment.account.name}</span>
          </div>
        </div>
      ))}
    </Page>
  );
}
