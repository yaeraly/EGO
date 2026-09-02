import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { PurchaseCard, PurchaseStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  LogisticsBadge,
  PaymentBadge,
  STATUS_LABEL,
  payableIsDue,
} from '../components/Badges';
import { Money, isNegative } from '../components/Money';
import { ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

const STAGES = Object.keys(STATUS_LABEL) as PurchaseStatus[];

/** The working screen (§2.8): lines, timeline, payments, remaining debt. */
export function PurchaseCardPage() {
  const { id = '' } = useParams();
  const { hasRole } = useAuth();
  const { data, error, loading, reload } = useApi<PurchaseCard>(
    `/purchase-board/${id}`,
  );

  if (loading) return <Page title="Заказ" back="/purchases"><Loading /></Page>;
  if (error || !data) {
    return (
      <Page title="Заказ" back="/purchases">
        <ErrorBanner message={error ?? 'Табылган жок'} />
      </Page>
    );
  }

  const outstanding = data.totals.outstanding_cny;
  const isDraft = data.document.status === 'DRAFT';

  return (
    <Page title={data.document.doc_number} back="/purchases">
      <div className="card">
        <div className="inline">
          <LogisticsBadge status={data.logistics.status} />
          <PaymentBadge status={data.totals.payment_status} />
          {isDraft && <span className="badge warn">Бекитилген эмес</span>}
        </div>
        <div className="row">
          <span className="muted">Поставщик</span>
          <Link to={`/suppliers/${data.supplier.id}`}>{data.supplier.name}</Link>
        </div>
        {data.cargo_company && (
          <div className="row">
            <span className="muted">Карго</span>
            <Link to={`/cargo/${data.cargo_company.id}`}>
              {data.cargo_company.name}
            </Link>
          </div>
        )}
        <div className="row">
          <span className="muted">Дата</span>
          <span>{data.document.business_date.slice(0, 10)}</span>
        </div>
        {data.document.comment && (
          <p className="muted" style={{ margin: 0 }}>{data.document.comment}</p>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Сумма</h3>
        <div className="row">
          <span>Заказ</span>
          <Money value={data.totals.total_cny} currency="CNY" className="big" />
        </div>
        <div className="row">
          <span>Төлөндү</span>
          <Money value={data.totals.paid_cny} currency="CNY" />
        </div>
        <div className="row">
          <span>Калган карыз</span>
          <Money value={outstanding} currency="CNY" className="big" />
        </div>
        {data.totals.total_kgs_reference && (
          <p className="muted" style={{ margin: 0 }}>
            Маалымат үчүн: ≈{' '}
            <Money value={data.totals.total_kgs_reference} currency="KGS" />{' '}
            (reference rate {data.totals.reference_rate},{' '}
            {data.totals.reference_rate_source}). Карыз юанда эсептелет (§4.2).
          </p>
        )}
        {hasRole('OWNER') && outstanding !== '0.00' && !isDraft && (
          <Link to={`/supplier-payments/new?supplier_id=${data.supplier.id}&purchase_id=${data.document.id}&amount=${outstanding}`}>
            <button style={{ width: '100%' }}>Поставщикке төлөө</button>
          </Link>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Товарлар</h3>
        <div className="lines">
          {data.items.map((item) => (
            <div className="line" key={item.product_id}>
              <div>
                <div>{item.name}</div>
                <div className="muted">
                  {item.sku} · {item.qty} × <Money value={item.price_cny} />
                </div>
              </div>
              <Money value={item.line_total_cny} currency="CNY" />
            </div>
          ))}
        </div>
      </div>

      <StatusSection card={data} onChanged={reload} stages={STAGES} />

      <div className="card">
        <h3 className="section-title">Төлөмдөр</h3>
        {!payableIsDue(data.logistics.status) && (
          <p className="banner info" style={{ margin: 0 }}>
            Товар поставщиктин складынан чыга элек — азырынча карыз жок (§6.5).
            Азыр төлөнгөн акча аванс болуп жазылат жана товар келгенде карызга
            эсептелет (§4.3).
          </p>
        )}
        {data.payments.length === 0 && <p className="muted">Төлөм жок.</p>}
        <div className="lines">
          {data.payments.map((payment) => (
            <div className="line" key={payment.document_id}>
              <div>
                <Money value={payment.amount_cny} currency="CNY" />
                <div className="muted">
                  Наркы: <Money value={payment.kgs_value} currency="KGS" />
                </div>
              </div>
              {payment.fx_gain_loss_kgs &&
                payment.fx_gain_loss_kgs !== '0' &&
                payment.fx_gain_loss_kgs !== '0.00' && (
                  <span
                    className={`badge ${isNegative(payment.fx_gain_loss_kgs) ? 'danger' : 'ok'}`}
                  >
                    FX <Money value={payment.fx_gain_loss_kgs} currency="KGS" />
                  </span>
                )}
            </div>
          ))}
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Поставщиктин жалпы балансы:{' '}
          <Money value={data.supplier_balance_cny} currency="CNY" />
        </p>
      </div>
    </Page>
  );
}

/** The §6 timeline, plus the one step forward anyone may take. */
function StatusSection({
  card,
  stages,
  onChanged,
}: {
  card: PurchaseCard;
  stages: PurchaseStatus[];
  onChanged: () => void;
}) {
  const { hasRole } = useAuth();
  const [target, setTarget] = useState<PurchaseStatus | ''>('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const currentIndex = stages.indexOf(card.logistics.status);
  const next = stages[currentIndex + 1];
  const isOwner = hasRole('OWNER');
  const confirmed = card.document.status === 'CONFIRMED';

  async function advance(status: PurchaseStatus) {
    setBusy(true);
    setError(null);
    try {
      await api(`/purchases/${card.document.id}/status`, {
        method: 'POST',
        body: { status, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      });
      setTarget('');
      setReason('');
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 className="section-title">Логистика (§6)</h3>
      <ul className="timeline">
        {card.logistics.history.map((entry) => (
          <li
            key={`${entry.stage}-${entry.entered_at}`}
            className={entry.days === null ? 'current' : ''}
          >
            <div className="row">
              <strong>
                {entry.stage}. {STATUS_LABEL[entry.status]}
              </strong>
              <span className="muted">
                {entry.days === null ? 'учурда' : `${entry.days} күн`}
              </span>
            </div>
            <div className="muted">{entry.entered_at.slice(0, 10)}</div>
          </li>
        ))}
      </ul>

      {card.logistics.lead_time_days !== null && (
        <p className="muted" style={{ margin: 0 }}>
          Жалпы жол: {card.logistics.lead_time_days} күн
        </p>
      )}

      <ErrorBanner message={error} />

      {confirmed && next && (
        <button disabled={busy} onClick={() => advance(next)}>
          Кийинки этап: {STATUS_LABEL[next]}
        </button>
      )}

      {confirmed && isOwner && (
        <>
          <label>
            Башка этапка өткөрүү (OWNER гана, аудитте калат)
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as PurchaseStatus | '')}
            >
              <option value="">—</option>
              {stages.map((stage) => (
                <option key={stage} value={stage}>
                  {STATUS_LABEL[stage]}
                </option>
              ))}
            </select>
          </label>
          {target && (
            <>
              <label>
                Себеби
                <input value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => advance(target)}
              >
                Өткөрүү
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
