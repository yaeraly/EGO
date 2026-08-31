import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import type { DefectAct, DefectDecision, LayerView, ProductStock } from '../api/types';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

const DECISION_LABEL: Record<DefectDecision, string> = {
  EXCHANGE: 'Алмаштыруу',
  REFUND: 'Акча кайтаруу',
  CLAIM: 'Поставщикке талап',
  WRITEOFF: 'Списание',
};

/** Defect acts (§37) — what is wrong, and what was decided about it. */
export function DefectsPage() {
  const defects = useApi<DefectAct[]>('/defects');
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, decision: DefectDecision) {
    setError(null);
    try {
      await api(`/defects/${id}/decision`, { method: 'PATCH', body: { decision } });
      defects.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function confirm(id: string) {
    setError(null);
    try {
      await api(`/documents/${id}/confirm`, { method: 'POST' });
      defects.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <Page title="Брак актылары">
      <ErrorBanner message={error ?? defects.error} />
      <p className="muted">
        Брак товар кадимки складга кирбейт — DEFECT кампасында турат (§37).
        Кепилдик заводдук бракка гана тиешелүү (§36-А.3).
      </p>

      {defects.loading && <Loading />}
      {defects.data?.length === 0 && <Empty text="Брак акты жок." />}

      {(defects.data ?? []).map((act) => (
        <div className="card" key={act.document_id}>
          <div className="row">
            <strong>{act.documents.doc_number}</strong>
            <span className="muted">{act.qty}</span>
          </div>
          <div className="row">
            <span>{act.products.name}</span>
            <span className="muted">{act.products.sku}</span>
          </div>
          <p className="muted" style={{ margin: 0 }}>{act.reason}</p>

          {act.documents.status === 'DRAFT' ? (
            <>
              <label>
                Чечим (§37)
                <select
                  value={act.decision ?? ''}
                  onChange={(e) => decide(act.document_id, e.target.value as DefectDecision)}
                >
                  <option value="">—</option>
                  {(Object.keys(DECISION_LABEL) as DefectDecision[]).map((value) => (
                    <option key={value} value={value}>
                      {DECISION_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!act.decision}
                onClick={() => confirm(act.document_id)}
              >
                Актыны тастыктоо
              </button>
            </>
          ) : (
            <div className="inline">
              <span className="badge ok">Тастыкталды</span>
              {act.decision && (
                <span className="badge neutral">{DECISION_LABEL[act.decision]}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </Page>
  );
}

/** Write-offs (§38) — scrapping what DEFECT has collected, and the metal money. */
export function WriteOffsPage() {
  const stock = useApi<ProductStock[]>('/stock');
  const [productId, setProductId] = useState('');
  const layers = useApi<LayerView[]>(
    productId ? `/stock/products/${productId}/layers` : null,
  );

  const [picked, setPicked] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const defectLayers = (layers.data ?? []).filter(
    (layer) => layer.warehouse_type === 'DEFECT',
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const items = Object.entries(picked)
      .filter(([, qty]) => qty.trim() && Number(qty) > 0)
      .map(([layerId, qty]) => ({ layer_id: layerId, qty: qty.trim() }));
    if (items.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      const warehouseId = defectLayers[0]?.warehouse_id;
      const document = await api<{ id: string }>('/write-offs', {
        method: 'POST',
        body: { warehouse_id: warehouseId, reason: reason.trim(), items },
      });

      const pin = window.prompt('PIN (списание ар дайым PIN талап кылат):');
      if (!pin?.trim()) return;

      await api(`/write-offs/${document.id}/confirm`, {
        method: 'POST',
        body: { pin: pin.trim() },
      });
      setDone(document.id);
      setPicked({});
      layers.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Списание (WOF)">
      <ErrorBanner message={error} />

      <form className="card" onSubmit={submit}>
        <label>
          Товар
          <select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">—</option>
            {(stock.data ?? []).map((entry) => (
              <option key={entry.product_id} value={entry.product_id}>
                {entry.sku} — {entry.name}
              </option>
            ))}
          </select>
        </label>

        {productId && defectLayers.length === 0 && (
          <Empty text="Бул товардын DEFECT кампасында калдыгы жок." />
        )}

        {defectLayers.map((layer) => (
          <label key={layer.layer_id}>
            {layer.layer_date} · {layer.qty} даана · <Money value={layer.unit_cost} />
            <input
              value={picked[layer.layer_id] ?? ''}
              inputMode="decimal"
              placeholder="0"
              onChange={(e) =>
                setPicked((rows) => ({ ...rows, [layer.layer_id]: e.target.value }))
              }
            />
          </label>
        ))}

        <label>
          Себеби
          <input value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>

        <button type="submit" disabled={busy || !reason.trim() || defectLayers.length === 0}>
          {busy ? 'Жүргүзүлүүдө…' : 'Списание кылуу'}
        </button>
        <p className="muted" style={{ margin: 0 }}>
          Ачык Supplier Claim бар болсо адегенде анын тагдыры чечилет (§38.2).
          Товар өз LOT'унун наркы менен эсептен чыгат.
        </p>
      </form>

      {done && <ScrapIncome writeOffId={done} />}
    </Page>
  );
}

/** §38.7 — the copper and aluminium money, against the act it came from. */
function ScrapIncome({ writeOffId }: { writeOffId: string }) {
  const accounts = useApi<{ account_id: string; name: string; currency: string; is_active: boolean }[]>(
    '/accounts/balances',
  );
  const result = useApi<{ written_off_cost: string; scrap_income: string; net_loss: string }>(
    `/write-offs/${writeOffId}/result`,
  );

  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/other-income', {
        method: 'POST',
        body: {
          category: 'METAL_SALE',
          account_id: accountId,
          amount: amount.trim(),
          linked_write_off: writeOffId,
          source: source.trim(),
        },
      });
      await api(`/documents/${document.id}/confirm`, { method: 'POST' });
      setAmount('');
      result.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3 className="section-title">Металлдан түшкөн киреше (§38.7)</h3>
      <ErrorBanner message={error} />

      {result.data && (
        <>
          <div className="row">
            <span>Эсептен чыккан өздүк нарк</span>
            <Money value={result.data.written_off_cost} currency="KGS" />
          </div>
          <div className="row">
            <span>Металлдан киреше</span>
            <Money value={result.data.scrap_income} currency="KGS" />
          </div>
          <div className="row">
            <strong>Брак боюнча таза жоготуу</strong>
            <Money value={result.data.net_loss} currency="KGS" />
          </div>
        </>
      )}

      <label>
        Кайсы эсепке
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          <option value="">—</option>
          {(accounts.data ?? [])
            .filter((account) => account.currency === 'KGS' && account.is_active)
            .map((account) => (
              <option key={account.account_id} value={account.account_id}>
                {account.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Сумма
        <input
          value={amount}
          inputMode="decimal"
          placeholder="0.00"
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </label>
      <label>
        Булагы (§38 — ар бир OIN булагы менен документтелет)
        <input value={source} onChange={(e) => setSource(e.target.value)} required />
      </label>

      <button type="submit" disabled={busy || !accountId || !amount.trim()}>
        Кирешени катоо
      </button>
      <p className="muted" style={{ margin: 0 }}>
        Брак жоготуулары сатуучулардын бонус базасына кирбейт (§38).
      </p>
    </form>
  );
}
