import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type {
  AccountBalance,
  DayClosePreCheck,
  DaySummary,
  MonthClosePreCheck,
} from '../api/types';
import { Money } from '../components/Money';
import { ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

const DAY_STATUS: Record<string, string> = {
  OPEN: 'Ачык',
  CASH_HANDED: 'Касса өткөрүлдү',
  DAY_CLOSED: 'Күн жабылды',
};

/**
 * The end of the day (§20, Period Lock).
 *
 * Two halves, in the order they happen: the salesperson compares their till
 * and hands it over, and then the OWNER closes the day — but only once
 * nothing is left unfinished. The pre-check names what is left rather than
 * counting it, because a count tells nobody what to go and do.
 */
export function DayClosePage() {
  const { hasRole } = useAuth();
  const isOwner = hasRole('OWNER');

  const summary = useApi<DaySummary>('/cash-handovers/summary');
  const preCheck = useApi<DayClosePreCheck>('/day-close/pre-check');
  const accounts = useApi<AccountBalance[]>('/accounts/balances');

  return (
    <Page title="Күндү жабуу">
      <MyDay summary={summary} accounts={accounts} preCheck={preCheck} />
      <PreCheck preCheck={preCheck} />
      {isOwner && <CloseDay preCheck={preCheck} summary={summary} />}
      {isOwner && <CloseMonth date={preCheck.data?.business_date} />}
    </Page>
  );
}

type Reloadable = { reload: () => void };

function MyDay({
  summary,
  accounts,
  preCheck,
}: {
  summary: ReturnType<typeof useApi<DaySummary>>;
  accounts: ReturnType<typeof useApi<AccountBalance[]>>;
  preCheck: Reloadable;
}) {
  const [actual, setActual] = useState('');
  const [reason, setReason] = useState('');
  const [toAccount, setToAccount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const day = summary.data;
  const cash = (day?.accounts ?? []).filter((line) => line.type === 'CASH');
  const difference =
    day && actual.trim()
      ? Number(actual) - Number(day.cash_expected)
      : 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/cash-handovers', {
        method: 'POST',
        body: {
          from_account: cash[0]?.account_id,
          to_account: toAccount,
          actual_amount: actual.trim(),
          ...(reason.trim() ? { difference_reason: reason.trim() } : {}),
        },
      });
      setActual('');
      setReason('');
      summary.reload();
      preCheck.reload();
      accounts.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h3 className="section-title">Менин күнүм (§20)</h3>
        {summary.loading && <Loading />}
        <ErrorBanner message={summary.error} />
        {day && (
          <>
            <div className="row">
              <span className="muted">{day.business_date}</span>
              <span className="badge neutral">{DAY_STATUS[day.day_status]}</span>
            </div>
            <div className="row">
              <span>Сатуу ({day.sales_count})</span>
              <Money value={day.sales_total} currency="KGS" />
            </div>
            <div className="row">
              <span className="muted">анын ичинде карызга</span>
              <span className="muted">{day.credit_total}</span>
            </div>
            <div className="row">
              <span className="muted">возврат</span>
              <span className="muted">{day.returns_total}</span>
            </div>
            <div className="row">
              <span className="muted">аванс</span>
              <span className="muted">{day.advances_total}</span>
            </div>
            {day.accounts.map((line) => (
              <div className="row" key={line.account_id}>
                <span>
                  {line.name}
                  <span className="muted"> · келди {line.received}</span>
                </span>
                <Money value={line.balance} currency="KGS" />
              </div>
            ))}
          </>
        )}
      </div>

      {day && day.handover && (
        <div className="card">
          <h3 className="section-title">Касса өткөрүлдү</h3>
          <div className="row">
            <span className="muted">система</span>
            <span>{day.handover.expected_amount}</span>
          </div>
          <div className="row">
            <span className="muted">саналганы</span>
            <span>{day.handover.actual_amount}</span>
          </div>
          <div className="row">
            <span className="muted">айырма</span>
            <strong>{day.handover.difference}</strong>
          </div>
          {day.handover.difference_reason && (
            <p className="muted" style={{ margin: 0 }}>
              {day.handover.difference_reason}
            </p>
          )}
        </div>
      )}

      {day && !day.handover && cash.length > 0 && (
        <form className="card" onSubmit={submit}>
          <h3 className="section-title">Кассаны өткөрүү</h3>
          <ErrorBanner message={error} />
          <div className="row">
            <span>Система айтат</span>
            <strong>
              <Money value={day.cash_expected} currency="KGS" />
            </strong>
          </div>

          <label>
            Саналган накталай
            <input
              value={actual}
              inputMode="decimal"
              placeholder={day.cash_expected}
              onChange={(e) => setActual(e.target.value)}
              required
            />
          </label>

          {actual.trim() && difference !== 0 && (
            <>
              <p className="banner warn">
                Айырма {difference > 0 ? '+' : ''}
                {difference.toFixed(2)} сом — себеби жазылышы керек (§20).
              </p>
              <label>
                Айырманын себеби
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </label>
            </>
          )}

          <label>
            Кайсы эсепке өткөрүлөт
            <select
              value={toAccount}
              onChange={(e) => setToAccount(e.target.value)}
              required
            >
              <option value="">—</option>
              {(accounts.data ?? [])
                .filter(
                  (account) =>
                    account.currency === 'KGS' &&
                    account.is_active &&
                    !day.accounts.some(
                      (mine) => mine.account_id === account.account_id,
                    ),
                )
                .map((account) => (
                  <option key={account.account_id} value={account.account_id}>
                    {account.name}
                  </option>
                ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={
              busy ||
              !actual.trim() ||
              !toAccount ||
              (difference !== 0 && !reason.trim())
            }
          >
            {busy ? 'Өткөрүлүүдө…' : 'Кассаны өткөрүү'}
          </button>
          <p className="muted" style={{ margin: 0 }}>
            Акча TRN документи менен өтөт (§19). Айырма чыкса, ал жазылат жана
            жоголбойт — акча кассада көрүнүп турат.
          </p>
        </form>
      )}
    </>
  );
}

function PreCheck({ preCheck }: { preCheck: ReturnType<typeof useApi<DayClosePreCheck>> }) {
  const check = preCheck.data;
  return (
    <div className="card">
      <h3 className="section-title">Күн жабууга даярбы (Period Lock)</h3>
      {preCheck.loading && <Loading />}
      <ErrorBanner message={preCheck.error} />
      {check && (
        <>
          <div className="row">
            <span className="muted">{check.business_date}</span>
            <span className={`badge ${check.can_close ? 'ok' : 'warn'}`}>
              {check.can_close ? 'Даяр' : DAY_STATUS[check.status]}
            </span>
          </div>

          {check.unresolved.length === 0 && check.pending_handovers.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Бүтпөгөн документ жок, бардык кассалар өткөрүлдү.
            </p>
          ) : (
            <>
              {check.unresolved.map((blocker) => (
                <div className="row" key={blocker.document_id}>
                  <strong>{blocker.doc_number}</strong>
                  <span className="muted">{blocker.detail}</span>
                </div>
              ))}
              {check.pending_handovers.map((person) => (
                <div className="row" key={person.user_id}>
                  <span>{person.full_name}</span>
                  <span className="muted">кассасын өткөргөн жок</span>
                </div>
              ))}
              <p className="muted" style={{ margin: 0 }}>
                Ар бир документ тастыкталсын же жокко чыгарылсын. Бүтпөгөн
                документ турганда күн жабылбайт — ээси да айланып өтө албайт.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function CloseDay({
  preCheck,
  summary,
}: {
  preCheck: ReturnType<typeof useApi<DayClosePreCheck>>;
  summary: Reloadable;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = preCheck.data;
  if (!check || check.status === 'DAY_CLOSED') {
    return check?.status === 'DAY_CLOSED' ? (
      <div className="card">
        <p className="banner ok" style={{ margin: 0 }}>
          {check.business_date} жабылды. Бул датага кадимки документ мындан ары
          түзүлбөйт; ката табылса — коррекция (COR, §27.1).
        </p>
      </div>
    ) : null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/day-close/close', { method: 'POST', body: { pin } });
      setPin('');
      preCheck.reload();
      summary.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3 className="section-title">Күндү жабуу (ээси)</h3>
      <ErrorBanner message={error} />
      <label>
        PIN
        <input
          value={pin}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          onChange={(e) => setPin(e.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={busy || !check.can_close || pin.length < 4}>
        {busy ? 'Жабылууда…' : 'Күндү жабуу'}
      </button>
    </form>
  );
}

function CloseMonth({ date }: { date?: string }) {
  const year = date ? Number(date.slice(0, 4)) : new Date().getUTCFullYear();
  const month = date ? Number(date.slice(5, 7)) : new Date().getUTCMonth() + 1;

  const check = useApi<MonthClosePreCheck>(`/month-close/${year}/${month}`);
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`/month-close/${year}/${month}/${path}`, {
        method: 'POST',
        body,
      });
      setPin('');
      setReason('');
      check.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const closed = check.data?.status === 'MONTH_CLOSED';

  return (
    <div className="card">
      <h3 className="section-title">
        Айды жабуу — {year}-{String(month).padStart(2, '0')}
      </h3>
      <ErrorBanner message={check.error} />
      <ErrorBanner message={error} />

      {check.data && (
        <div className="row">
          <span className="muted">
            {closed ? 'Ай жабык' : `жабылбаган күн: ${check.data.open_days.length}`}
          </span>
          <span className={`badge ${closed ? 'ok' : 'neutral'}`}>
            {closed ? 'MONTH_CLOSED' : 'OPEN'}
          </span>
        </div>
      )}

      {(check.data?.open_days ?? []).map((day) => (
        <div className="row" key={day.business_date}>
          <span className="muted">{day.business_date}</span>
          <span className="muted">{DAY_STATUS[day.status]}</span>
        </div>
      ))}

      <label>
        PIN
        <input
          value={pin}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          onChange={(e) => setPin(e.target.value)}
        />
      </label>

      {closed ? (
        <>
          <label>
            Кайра ачуунун себеби
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={busy || pin.length < 4 || reason.trim().length < 10}
            onClick={() => act('reopen', { pin, reason: reason.trim() })}
          >
            Айды кайра ачуу
          </button>
          <p className="muted" style={{ margin: 0 }}>
            Кайра ачуу — күнүмдүк оңдоо ыкмасы эмес. Жабылган мезгилдеги ката
            коррекция (COR) менен оңдолот (§27.1).
          </p>
        </>
      ) : (
        <button
          type="button"
          disabled={busy || !check.data?.can_close || pin.length < 4}
          onClick={() => act('close', { pin })}
        >
          Айды жабуу
        </button>
      )}
    </div>
  );
}
