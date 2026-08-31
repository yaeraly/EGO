import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type {
  Claim,
  Discrepancy,
  DiscrepancyStatus,
  DiscrepancyType,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import {
  DISCREPANCY_STATUS_LABEL,
  DISCREPANCY_TYPE_LABEL,
  discrepancyStatusTone,
} from '../components/module3-labels';
import { useApi } from '../hooks/useApi';

const TYPES = Object.keys(DISCREPANCY_TYPE_LABEL) as DiscrepancyType[];

/** Discrepancies (DIF) — §8. Raised by receipts, never by hand. */
export function DiscrepanciesPage() {
  const [params] = useSearchParams();
  const receiptId = params.get('receipt_id');
  const [status, setStatus] = useState<DiscrepancyStatus | ''>('');

  const query = new URLSearchParams();
  if (receiptId) query.set('receipt_id', receiptId);
  if (status) query.set('status', status);
  const suffix = query.toString() ? `?${query}` : '';

  const list = useApi<Discrepancy[]>(`/discrepancies${suffix}`);

  return (
    <Page title="Расхождениелер (DIF)">
      <div className="card">
        <label>
          Статус
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as DiscrepancyStatus | '')}
          >
            <option value="">Баары</option>
            {(Object.keys(DISCREPANCY_STATUS_LABEL) as DiscrepancyStatus[]).map(
              (option) => (
                <option key={option} value={option}>
                  {DISCREPANCY_STATUS_LABEL[option]}
                </option>
              ),
            )}
          </select>
        </label>
      </div>

      <ErrorBanner message={list.error} />
      {list.loading && <Loading />}
      {list.data && list.data.length === 0 && <Empty text="Расхождение жок." />}

      {(list.data ?? []).map((dif) => (
        <Link
          key={dif.document_id}
          to={`/discrepancies/${dif.document_id}`}
          className="card card-link"
        >
          <div className="row">
            <strong>{dif.documents.doc_number}</strong>
            <span className={`badge ${discrepancyStatusTone(dif.dstatus)}`}>
              {DISCREPANCY_STATUS_LABEL[dif.dstatus]}
            </span>
          </div>
          <div className="row">
            <span>{dif.products.name}</span>
            <span className="money">{dif.diff_qty}</span>
          </div>
          <div className="inline">
            <span className="badge info">{DISCREPANCY_TYPE_LABEL[dif.dtype]}</span>
            <span className="muted">
              заказ {dif.ordered_qty} · келди {dif.received_qty}
            </span>
          </div>
        </Link>
      ))}
    </Page>
  );
}

/** One act, with the claim raised against it (§8.4, §8.5). */
export function DiscrepancyPage() {
  const { id = '' } = useParams();
  const { hasRole } = useAuth();
  const dif = useApi<Discrepancy>(`/discrepancies/${id}`);
  const claims = useApi<Claim[]>('/claims');

  const [dtype, setDtype] = useState<DiscrepancyType | ''>('');
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reclassify() {
    setBusy(true);
    setError(null);
    try {
      await api(`/discrepancies/${id}`, {
        method: 'PATCH',
        body: {
          ...(dtype ? { dtype } : {}),
          ...(decision.trim() ? { financial_decision: decision.trim() } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      });
      dif.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openClaim(ctype: 'SUPPLIER_CLAIM' | 'CARGO_CLAIM') {
    setBusy(true);
    setError(null);
    try {
      await api('/claims', {
        method: 'POST',
        body: { discrepancy_id: id, ctype },
      });
      claims.reload();
      dif.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (dif.loading) return <Page title="Расхождение" back="/discrepancies"><Loading /></Page>;
  if (!dif.data) {
    return (
      <Page title="Расхождение" back="/discrepancies">
        <ErrorBanner message={dif.error ?? 'Табылган жок'} />
      </Page>
    );
  }

  const linked = (claims.data ?? []).filter((claim) => claim.discrepancy_id === id);
  const settled =
    dif.data.dstatus === 'CLOSED' || dif.data.dstatus === 'WRITTEN_OFF';

  return (
    <Page title={dif.data.documents.doc_number} back="/discrepancies">
      <div className="card">
        <div className="inline">
          <span className="badge info">
            {DISCREPANCY_TYPE_LABEL[dif.data.dtype]}
          </span>
          <span className={`badge ${discrepancyStatusTone(dif.data.dstatus)}`}>
            {DISCREPANCY_STATUS_LABEL[dif.data.dstatus]}
          </span>
        </div>
        <div className="row">
          <span className="muted">Товар</span>
          <span>{dif.data.products.name}</span>
        </div>
        <div className="row">
          <span className="muted">Заказ / келди / айырма</span>
          <span className="money">
            {dif.data.ordered_qty} / {dif.data.received_qty} / {dif.data.diff_qty}
          </span>
        </div>
        {dif.data.financial_decision && (
          <p className="muted" style={{ margin: 0 }}>
            Чечим: {dif.data.financial_decision}
          </p>
        )}
        {dif.data.dtype === 'EXCESS' && (
          <p className="banner warn">
            Ашыкча товар автоматтык түрдө акысыз деп эсептелбейт. OWNER
            себебин тактап, чечим документтелгенде гана складга киргизилет
            (§8.8).
          </p>
        )}
      </div>

      <ErrorBanner message={error} />

      {hasRole('OWNER') && !settled && (
        <div className="card">
          <h3 className="section-title">Себебин тактоо (§8.4)</h3>
          <label>
            Түрү
            <select
              value={dtype}
              onChange={(e) => setDtype(e.target.value as DiscrepancyType | '')}
            >
              <option value="">Өзгөртпөө</option>
              {TYPES.map((option) => (
                <option key={option} value={option}>
                  {DISCREPANCY_TYPE_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Финансылык чечим
            <input value={decision} onChange={(e) => setDecision(e.target.value)} />
          </label>
          <label>
            Себеби (аудитке жазылат)
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button disabled={busy} onClick={reclassify}>
            Сактоо
          </button>
        </div>
      )}

      <div className="card">
        <h3 className="section-title">Талаптар (CLM)</h3>
        {linked.length === 0 && <p className="muted">Талап түзүлө элек.</p>}
        <div className="lines">
          {linked.map((claim) => (
            <Link
              key={claim.document_id}
              to={`/claims/${claim.document_id}`}
              className="line card-link"
            >
              <div>
                <div>{claim.documents.doc_number}</div>
                <div className="muted">
                  {DISCREPANCY_STATUS_LABEL[claim.cstatus]}
                </div>
              </div>
              <Money value={claim.amount} currency={claim.currency} />
            </Link>
          ))}
        </div>

        {hasRole('OWNER') && linked.length === 0 && !settled && (
          <div className="inline">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => openClaim('SUPPLIER_CLAIM')}
            >
              Поставщикке талап (CNY)
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => openClaim('CARGO_CLAIM')}
            >
              Каргого талап (USD)
            </button>
          </div>
        )}
      </div>
    </Page>
  );
}
