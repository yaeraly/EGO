import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { Claim } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import {
  DISCREPANCY_STATUS_LABEL,
  discrepancyStatusTone,
} from '../components/module3-labels';
import { useApi } from '../hooks/useApi';

export function ClaimListPage() {
  const claims = useApi<Claim[]>('/claims');

  return (
    <Page title="Талаптар (CLM)">
      <ErrorBanner message={claims.error} />
      {claims.loading && <Loading />}
      {claims.data && claims.data.length === 0 && <Empty text="Талап жок." />}

      {(claims.data ?? []).map((claim) => (
        <Link
          key={claim.document_id}
          to={`/claims/${claim.document_id}`}
          className="card card-link"
        >
          <div className="row">
            <strong>{claim.documents.doc_number}</strong>
            <Money value={claim.amount} currency={claim.currency} />
          </div>
          <div className="inline">
            <span className="badge neutral">
              {claim.ctype === 'SUPPLIER_CLAIM' ? 'Поставщикке' : 'Каргого'}
            </span>
            <span className={`badge ${discrepancyStatusTone(claim.cstatus)}`}>
              {DISCREPANCY_STATUS_LABEL[claim.cstatus]}
            </span>
          </div>
        </Link>
      ))}
    </Page>
  );
}

/** One claim, with its compensation history (§8.7) and write-off (§8.5). */
export function ClaimPage() {
  const { id = '' } = useParams();
  const { hasRole } = useAuth();
  const claim = useApi<Claim>(`/claims/${id}`);

  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [writeoffReason, setWriteoffReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(path: string, body: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST') {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method, body });
      setAmount('');
      setComment('');
      setWriteoffReason('');
      claim.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (claim.loading) return <Page title="Талап" back="/claims"><Loading /></Page>;
  if (!claim.data) {
    return (
      <Page title="Талап" back="/claims">
        <ErrorBanner message={claim.error ?? 'Табылган жок'} />
      </Page>
    );
  }

  const data = claim.data;
  const open =
    data.cstatus !== 'COMPENSATED' &&
    data.cstatus !== 'WRITTEN_OFF' &&
    data.cstatus !== 'CLOSED';

  return (
    <Page title={data.documents.doc_number} back="/claims">
      <div className="card">
        <div className="inline">
          <span className="badge neutral">
            {data.ctype === 'SUPPLIER_CLAIM' ? 'Поставщикке' : 'Каргого'}
          </span>
          <span className={`badge ${discrepancyStatusTone(data.cstatus)}`}>
            {DISCREPANCY_STATUS_LABEL[data.cstatus]}
          </span>
        </div>
        <div className="row">
          <span className="muted">Талап суммасы</span>
          <Money value={data.amount} currency={data.currency} className="big" />
        </div>
        {data.compensated_total !== undefined && (
          <>
            <div className="row">
              <span className="muted">Компенсацияланды</span>
              <Money value={data.compensated_total} currency={data.currency} />
            </div>
            <div className="row">
              <span className="muted">Калды</span>
              <Money value={data.remaining!} currency={data.currency} />
            </div>
          </>
        )}
        {data.discrepancy_id && (
          <Link to={`/discrepancies/${data.discrepancy_id}`}>
            Баштапкы расхождение актысы
          </Link>
        )}
        {data.writeoff_reason && (
          <p className="banner danger">
            Эсептен чыгарылды: {data.writeoff_reason}. Сумма «Логистикалык/
            поставщик жоготуулары» статьясына кирди жана бонус базасына
            кирбейт (§8.5).
          </p>
        )}
      </div>

      <ErrorBanner message={error} />

      <div className="card">
        <h3 className="section-title">Компенсация тарыхы (§8.7)</h3>
        {data.claim_compensations.length === 0 && (
          <p className="muted">Компенсация жок.</p>
        )}
        <div className="lines">
          {data.claim_compensations.map((row) => (
            <div className="line" key={row.id}>
              <div>
                <Money value={row.amount} currency={data.currency} />
                <div className="muted">
                  {row.created_at.slice(0, 10)}
                  {row.receipt_id ? ' · товар менен' : ' · акча менен'}
                </div>
                {row.comment && <div className="muted">{row.comment}</div>}
              </div>
              {row.receipt_id && (
                <Link to={`/receipts/${row.receipt_id}`}>Приход</Link>
              )}
            </div>
          ))}
        </div>
      </div>

      {hasRole('OWNER') && open && (
        <>
          <div className="card">
            <h3 className="section-title">Компенсация кошуу</h3>
            <label>
              Сумма ({data.currency})
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            </label>
            <label>
              Комментарий
              <input value={comment} onChange={(e) => setComment(e.target.value)} />
            </label>
            <button
              disabled={busy || !amount.trim()}
              onClick={() =>
                run(`/claims/${id}/compensations`, {
                  amount: amount.trim(),
                  ...(comment.trim() ? { comment: comment.trim() } : {}),
                })
              }
            >
              Кошуу
            </button>
          </div>

          <div className="card">
            <h3 className="section-title">Эсептен чыгаруу (§8.5)</h3>
            <p className="muted" style={{ margin: 0 }}>
              Компенсация болбой калса гана. Себеби милдеттүү жана аудитте
              калат.
            </p>
            <label>
              Себеби
              <input
                value={writeoffReason}
                onChange={(e) => setWriteoffReason(e.target.value)}
              />
            </label>
            <button
              className="secondary"
              disabled={busy || writeoffReason.trim().length < 3}
              onClick={() =>
                run(
                  `/claims/${id}/status`,
                  {
                    cstatus: 'WRITTEN_OFF',
                    writeoff_reason: writeoffReason.trim(),
                  },
                  'PATCH',
                )
              }
            >
              Эсептен чыгаруу
            </button>
          </div>
        </>
      )}
    </Page>
  );
}
