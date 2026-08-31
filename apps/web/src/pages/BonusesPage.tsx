import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import type {
  AccountBalance,
  BonusRow,
  BonusStanding,
  BonusStatus,
} from '../api/types';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * Seller bonus (§23) and its payment (BON).
 *
 * Two figures are kept apart on purpose: what a seller has *earned* and what
 * is *ready to hand over*. §23.2 makes the second wait for the sale's own
 * money to arrive, so showing one number would hide the rule.
 */

const STATUS_LABEL: Record<BonusStatus, string> = {
  CALCULATED: 'Эсептелди',
  PAYABLE: 'Төлөөгө даяр',
  PAID: 'Төлөндү',
  ADJUSTED: 'Корректировка',
  REVERSED: 'Жокко чыкты',
};

const STATUS_TONE: Record<BonusStatus, string> = {
  CALCULATED: 'neutral',
  PAYABLE: 'warn',
  PAID: 'ok',
  ADJUSTED: 'warn',
  REVERSED: 'neutral',
};

export function BonusesPage() {
  const standing = useApi<BonusStanding[]>('/bonuses/standing');
  const accounts = useApi<AccountBalance[]>('/accounts/balances');

  const [employeeId, setEmployeeId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bonuses = useApi<BonusRow[]>(
    employeeId ? `/bonuses?employee_id=${employeeId}` : '/bonuses',
  );

  const chosen = (standing.data ?? []).find(
    (row) => row.employee_id === employeeId,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/bonuses/payments', {
        method: 'POST',
        body: {
          employee_id: employeeId,
          account_id: accountId,
          ...(amount.trim() ? { amount: amount.trim() } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
      });
      await api(`/documents/${document.id}/confirm`, { method: 'POST' });
      setAmount('');
      setComment('');
      standing.reload();
      accounts.reload();
      bonuses.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Сатуучунун бонусу (§23)">
      <div className="card">
        <h3 className="section-title">Кимде канча (§23.2)</h3>
        {standing.loading && <Loading />}
        <ErrorBanner message={standing.error} />
        {(standing.data ?? []).map((row) => (
          <div className="row" key={row.employee_id}>
            <span>
              {row.full_name}
              <span className="muted"> · {row.bonus_rate_pct}%</span>
            </span>
            <span className="inline">
              <span className="muted">
                эсептелди <Money value={row.calculated} currency="KGS" />
              </span>
              <strong>
                <Money value={row.payable} currency="KGS" />
              </strong>
            </span>
          </div>
        ))}
        <p className="muted" style={{ margin: 0 }}>
          Бонус = (сатуу суммасы − FIFO өздүк нарк) × ставка. Сатуунун акчасы
          толук келгенде гана төлөөгө даяр болот (§23.1–23.2).
        </p>
      </div>

      <form className="card" onSubmit={submit}>
        <h3 className="section-title">Бонус төлөө (BON)</h3>
        <ErrorBanner message={error} />

        <label>
          Кызматкер
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            required
          >
            <option value="">—</option>
            {(standing.data ?? []).map((row) => (
              <option key={row.employee_id} value={row.employee_id}>
                {row.full_name} · {row.payable}
              </option>
            ))}
          </select>
        </label>

        {chosen && chosen.bonus_rate_pct === '0.00' && (
          <p className="banner warn">
            Бул кызматкердин бонус ставкасы 0% — сатуулары бонус жаратпайт.
            Ставканы кызматкердин карточкасынан же BONUS_DEFAULT_RATE_PCT
            жөндөөсүнөн коюңуз.
          </p>
        )}

        <label>
          Сумма
          <input
            value={amount}
            inputMode="decimal"
            placeholder={chosen?.payable ?? '0.00'}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <p className="muted" style={{ margin: 0 }}>
          Бош калтырсаңыз — төлөөгө даяр сумманын баары төлөнөт. Даяр суммадан
          ашык төлөө кабыл алынбайт.
        </p>

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

        <label>
          Комментарий
          <input value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>

        <button type="submit" disabled={busy || !employeeId || !accountId}>
          {busy ? 'Төлөнүүдө…' : 'Бонусту төлөө'}
        </button>
      </form>

      <div className="card">
        <h3 className="section-title">
          {chosen ? `${chosen.full_name} — бонустары` : 'Бардык бонустар'}
        </h3>
        {bonuses.loading && <Loading />}
        <ErrorBanner message={bonuses.error} />
        {bonuses.data?.length === 0 && <Empty text="Бонус жок." />}
        {(bonuses.data ?? []).map((bonus) => (
          <div className="row" key={bonus.id}>
            <span>
              <span className={`badge ${STATUS_TONE[bonus.status]}`}>
                {STATUS_LABEL[bonus.status]}
              </span>
              <span className="muted">
                {' '}
                {bonus.revenue} − {bonus.fifo_cogs} @ {bonus.bonus_rate}%
              </span>
            </span>
            <span className="inline">
              {bonus.adjustment_amount !== '0.00' && (
                <span className="muted">−{bonus.adjustment_amount}</span>
              )}
              <Money value={bonus.payable_amount} currency="KGS" />
            </span>
          </div>
        ))}
      </div>
    </Page>
  );
}
