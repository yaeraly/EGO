import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import type { CorrectableDocument, CorrectionRow } from '../api/types';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * Correction / Reversal (COR) — §27.1, Period Lock.
 *
 * The screen offers the documents it can actually reverse, so the OWNER picks
 * the mistake they just made rather than being refused after typing out a
 * reason. What it cannot reverse — a sale, a receipt, anything that moved
 * stock — is said plainly below, with what to do instead.
 */
export function CorrectionsPage() {
  const candidates = useApi<CorrectableDocument[]>('/corrections/correctable');
  const corrections = useApi<CorrectionRow[]>('/corrections');

  const [documentId, setDocumentId] = useState('');
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The draft raised by a previous attempt.
   *
   * A mistyped PIN should not cost a document number: the draft is already
   * numbered, so a retry with the same details confirms that one instead of
   * raising a second. Changing any detail starts a new draft.
   */
  const [pending, setPending] = useState<{ id: string; key: string } | null>(
    null,
  );

  const chosen = (candidates.data ?? []).find(
    (row) => row.document.id === documentId,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const key = `${documentId}|${reason.trim()}|${effectiveDate}`;
    try {
      const draftId =
        pending?.key === key
          ? pending.id
          : (
              await api<{ id: string }>('/corrections', {
                method: 'POST',
                body: {
                  original_document_id: documentId,
                  correction_type: 'REVERSAL',
                  reason: reason.trim(),
                  ...(effectiveDate ? { effective_date: effectiveDate } : {}),
                },
              })
            ).id;
      setPending({ id: draftId, key });

      await api(`/corrections/${draftId}/confirm`, {
        method: 'POST',
        body: { pin },
      });
      setPending(null);
      setDocumentId('');
      setReason('');
      setEffectiveDate('');
      setPin('');
      candidates.reload();
      corrections.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Коррекция (COR)">
      <form className="card" onSubmit={submit}>
        <h3 className="section-title">Документти жокко чыгаруу (§27.1)</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Тастыкталган документ түз өзгөртүлбөйт жана өчүрүлбөйт. Коррекция
          баштапкы документтин акча кыймылын так тескери жазат; баштапкы
          документ тарыхта кала берет.
        </p>
        <ErrorBanner message={error} />
        {candidates.loading && <Loading />}
        <ErrorBanner message={candidates.error} />

        <label>
          Кайсы документ
          <select
            value={documentId}
            onChange={(e) => {
              setDocumentId(e.target.value);
              setEffectiveDate('');
            }}
            required
          >
            <option value="">—</option>
            {(candidates.data ?? []).map((row) => (
              <option key={row.document.id} value={row.document.id}>
                {row.document.doc_number} ·{' '}
                {row.document.business_date.slice(0, 10)} · {row.amount}
              </option>
            ))}
          </select>
        </label>

        {candidates.data?.length === 0 && (
          <p className="banner warn">
            Жокко чыгарууга даяр документ жок. Сатуунун катасы возврат (RET)
            менен оңдолот (§35); складды кыймылдаткан документтин коррекциясы
            азырынча колдоого алынган эмес.
          </p>
        )}

        <label>
          Себеби (милдеттүү, кеминде 10 белги)
          <input
            value={reason}
            placeholder="Эмне ката болгонун жазыңыз"
            onChange={(e) => setReason(e.target.value)}
            required
          />
        </label>

        <label>
          Кайсы мезгилге тиешелүү
          <input
            type="date"
            value={
              effectiveDate ||
              chosen?.document.business_date.slice(0, 10) ||
              ''
            }
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </label>
        <p className="muted" style={{ margin: 0 }}>
          Демейки — баштапкы документтин датасы: августтагы ката сентябрда
          табылса да август мезгилине тиешелүү. Коррекция качан киргизилгени
          өзүнчө сакталат. Жабылган мезгилге кире турган бирден-бир документ —
          ушул.
        </p>

        <label>
          PIN (ээси)
          <input
            value={pin}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => setPin(e.target.value)}
            required
          />
        </label>

        <button
          type="submit"
          disabled={busy || !documentId || reason.trim().length < 10 || pin.length < 4}
        >
          {busy ? 'Жокко чыгарылууда…' : 'Жокко чыгаруу'}
        </button>
      </form>

      <div className="card">
        <h3 className="section-title">Түзүлгөн коррекциялар</h3>
        {corrections.loading && <Loading />}
        <ErrorBanner message={corrections.error} />
        {corrections.data?.length === 0 && <Empty text="Коррекция жок." />}
      </div>

      {(corrections.data ?? []).map((row) => (
        <div className="card" key={row.document_id}>
          <div className="row">
            <strong>{row.document.doc_number}</strong>
            <span className="badge neutral">{row.document.status}</span>
          </div>
          <div className="row">
            <span className="muted">
              {row.original.doc_type} {row.original.doc_number} ·{' '}
              {row.original.business_date.slice(0, 10)}
            </span>
            <span className="muted">мезгили {row.effective_date.slice(0, 10)}</span>
          </div>
          <div className="row">
            <span className="muted">киргизилди</span>
            <span className="muted">
              {row.document.created_at.slice(0, 16).replace('T', ' ')}
            </span>
          </div>
          {(row.new_value.account_movements ?? []).map((movement, index) => (
            <div className="row" key={`${row.document_id}-${index}`}>
              <span className="muted">{movement.account}</span>
              <Money value={movement.amount} currency="KGS" />
            </div>
          ))}
          <p className="muted" style={{ margin: 0 }}>
            {row.reason}
          </p>
        </div>
      ))}
    </Page>
  );
}
