import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { AccountBalance, SaleAssessment } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

interface Channel {
  accountId: string;
  amount: string;
  cashGiven: string;
}

/**
 * Steps 3 and 4 of the sale (§14): take the money, then confirm.
 *
 * The total is the biggest thing on the page, because it is what the person
 * at the counter is reading out. Everything else — change, debt, a PIN — only
 * shows when it applies.
 */
export function SaleCheckoutPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { hasRole, user } = useAuth();

  const sale = useApi<SaleAssessment>(`/sales/${id}/preview`);
  const accounts = useApi<AccountBalance[]>('/accounts/balances');

  const [channels, setChannels] = useState<Channel[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [pin, setPin] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);

  // §19: a sale's money goes into the salesperson's own account, so those
  // are the only ones offered. The server refuses any other.
  const tills = (accounts.data ?? []).filter(
    (account) =>
      account.currency === 'KGS' &&
      account.is_active &&
      account.owner_user === user?.id,
  );

  async function savePayments() {
    setBusy(true);
    setError(null);
    try {
      await api(`/sales/${id}/payments`, {
        method: 'POST',
        body: {
          payments: channels
            .filter((line) => line.amount.trim())
            .map((line) => ({
              account_id: line.accountId,
              amount: line.amount.trim(),
              ...(line.cashGiven.trim() ? { cash_given: line.cashGiven.trim() } : {}),
            })),
          ...(dueDate ? { debt_due_date: dueDate } : {}),
        },
      });
      sale.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    setDetail(null);
    try {
      await api(`/sales/${id}/confirm`, {
        method: 'POST',
        body: {
          ...(pin.trim() ? { pin: pin.trim() } : {}),
          ...(overrideReason.trim()
            ? { credit_override_reason: overrideReason.trim() }
            : {}),
        },
      });
      navigate('/sales');
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError(String(e));
      }
      sale.reload();
    } finally {
      setBusy(false);
    }
  }

  async function requestApproval() {
    setBusy(true);
    setError(null);
    try {
      await api(`/sales/${id}/approval-request`, { method: 'POST' });
      sale.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (sale.loading) return <Page title="Сатуу" back="/sell"><Loading /></Page>;
  if (!sale.data) {
    return (
      <Page title="Сатуу" back="/sell">
        <ErrorBanner message={sale.error ?? 'Табылган жок'} />
      </Page>
    );
  }

  const data = sale.data;
  const confirmed = data.status === 'CONFIRMED';
  const owesMoney = Number(data.payment.outstanding) > 0;
  const needsApproval = data.blocks.some((b) => b.needs_owner_approval);

  return (
    <Page title={data.doc_number} back="/sell">
      <div className="card">
        <div className="row">
          <span className="muted">{data.customer.name}</span>
          {data.is_loss_sale && <span className="badge danger">LSS</span>}
          {confirmed && <span className="badge ok">Тастыкталды</span>}
        </div>

        <div className="row">
          <strong>Төлөнөт</strong>
          <Money value={data.totals.total} currency="KGS" className="big" />
        </div>

        {data.totals.discount_amount !== '0.00' && (
          <div className="row">
            <span className="muted">Скидка</span>
            <span>
              <Money value={data.totals.discount_amount} /> ({data.totals.discount_pct}%)
            </span>
          </div>
        )}
        {data.totals.fifo_cogs && (
          <div className="row">
            <span className="muted">Өздүк нарк / маржа</span>
            <span>
              <Money value={data.totals.fifo_cogs} /> /{' '}
              <Money value={data.totals.margin!} />
            </span>
          </div>
        )}
      </div>

      <ErrorBanner message={error} />
      {detail && <p className="banner warn">{JSON.stringify(detail)}</p>}

      {data.blocks.length > 0 && (
        <div className="card">
          <h3 className="section-title">Тастыктоого тоскоол</h3>
          {data.blocks.map((block) => (
            <p
              key={block.code + (block.sku ?? '')}
              className={`banner ${block.needs_owner_approval ? 'warn' : 'error'}`}
            >
              {block.message}
            </p>
          ))}
          {needsApproval && data.approval_status !== 'PENDING' && (
            <button className="secondary" disabled={busy} onClick={requestApproval}>
              OWNER'ден бекитүү сурап жиберүү (§13.5)
            </button>
          )}
          {data.approval_status === 'PENDING' && (
            <p className="banner info">
              OWNER'дин чечими күтүлүүдө.{' '}
              {hasRole('OWNER') && <Link to="/approvals">Бекитүү экраны</Link>}
            </p>
          )}
          {data.approval_status === 'REJECTED' && (
            <p className="banner error">OWNER скидканы четке какты.</p>
          )}
        </div>
      )}

      {!confirmed && (
        <div className="card">
          <h3 className="section-title">Төлөм (§15)</h3>

          {channels.map((channel, index) => (
            <div key={index} className="line" style={{ display: 'block' }}>
              <label>
                Канал
                <select
                  value={channel.accountId}
                  onChange={(e) =>
                    setChannels((rows) =>
                      rows.map((row, i) =>
                        i === index ? { ...row, accountId: e.target.value } : row,
                      ),
                    )
                  }
                >
                  <option value="">—</option>
                  {tills.map((till) => (
                    <option key={till.account_id} value={till.account_id}>
                      {till.name} ({till.type})
                    </option>
                  ))}
                </select>
              </label>
              <div className="inline">
                <label style={{ flex: 1 }}>
                  Сумма
                  <input
                    value={channel.amount}
                    inputMode="decimal"
                    onChange={(e) =>
                      setChannels((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, amount: e.target.value } : row,
                        ),
                      )
                    }
                  />
                </label>
                <label style={{ flex: 1 }}>
                  Берген накталай
                  <input
                    value={channel.cashGiven}
                    inputMode="decimal"
                    placeholder="сдача үчүн"
                    onChange={(e) =>
                      setChannels((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, cashGiven: e.target.value } : row,
                        ),
                      )
                    }
                  />
                </label>
              </div>
              <button
                className="link"
                onClick={() =>
                  setChannels((rows) => rows.filter((_, i) => i !== index))
                }
              >
                Каналды өчүрүү
              </button>
            </div>
          ))}

          <button
            className="secondary"
            onClick={() =>
              setChannels((rows) => [
                ...rows,
                {
                  accountId: tills[0]?.account_id ?? '',
                  amount:
                    rows.length === 0 ? data.totals.total : '',
                  cashGiven: '',
                },
              ])
            }
          >
            Канал кошуу
          </button>

          <button className="secondary" disabled={busy} onClick={savePayments}>
            Төлөмдү сактоо
          </button>

          <div className="row">
            <span>Төлөндү</span>
            <Money value={data.payment.paid} currency="KGS" />
          </div>
          {Number(data.payment.change) > 0 && (
            <div className="row">
              <strong>Сдача</strong>
              <Money value={data.payment.change} currency="KGS" className="big" />
            </div>
          )}
          {owesMoney && (
            <>
              <p className="banner warn">
                Карыз: <Money value={data.payment.outstanding} currency="KGS" />
              </p>
              {data.customer.is_walk_in ? (
                <p className="banner error">
                  Walk-in кардарга карызга сатуу колдонулбайт (§11.1.2) — толук
                  төлөм керек, же кардарды каттаңыз.
                </p>
              ) : (
                <label>
                  Төлөө мөөнөтү (милдеттүү — §16)
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
        </div>
      )}

      {!confirmed && (
        <div className="card">
          {data.pin_required && (
            <label>
              PIN ({data.pin_reasons.join(', ')})
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </label>
          )}

          {hasRole('OWNER') && owesMoney && (
            <label>
              Кредит блогун override кылуу себеби (OWNER гана — §16.5)
              <input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
            </label>
          )}

          <button disabled={busy || data.blocks.length > 0} onClick={confirm}>
            {busy ? 'Тастыкталууда…' : 'Сатууну тастыктоо'}
          </button>
        </div>
      )}

      {confirmed && (
        <div className="card">
          <p className="banner ok">Сатуу тастыкталды.</p>
          <button onClick={() => navigate('/sell')}>Жаңы сатуу</button>
        </div>
      )}
    </Page>
  );
}
