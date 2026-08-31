import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { Inventory, InventoryLine } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * The count sheet (§22).
 *
 * Made for a phone held in one hand in front of a shelf: one row per product,
 * the system's figure beside the box to type into, and the difference shown
 * the moment it stops matching.
 */
export function InventoryPage() {
  const { id = '' } = useParams();
  const { hasRole } = useAuth();
  const inventory = useApi<Inventory>(id ? `/inventories/${id}` : null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [excess, setExcess] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const lines = Object.entries(counts)
      .filter(([, value]) => value.trim())
      .map(([lineId, value]) => ({ line_id: lineId, actual_qty: value.trim() }));
    if (lines.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      await api(`/inventories/${id}/count`, { method: 'PATCH', body: { lines } });
      setCounts({});
      inventory.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const reason = window.prompt('Корректировканын себеби (§22):');
    if (!reason?.trim()) return;
    const pin = window.prompt('PIN:');
    if (!pin?.trim()) return;

    setBusy(true);
    setError(null);
    try {
      await api(`/inventories/${id}/confirm`, {
        method: 'POST',
        body: {
          pin: pin.trim(),
          reason: reason.trim(),
          excess_costs: Object.entries(excess)
            .filter(([, value]) => value.trim())
            .map(([lineId, value]) => ({
              line_id: lineId,
              unit_cost: value.trim(),
            })),
        },
      });
      inventory.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (inventory.loading) {
    return <Page title="Саноо" back="/inventories"><Loading /></Page>;
  }
  if (!inventory.data) {
    return (
      <Page title="Саноо" back="/inventories">
        <ErrorBanner message={inventory.error ?? 'Табылган жок'} />
      </Page>
    );
  }

  const data = inventory.data;
  const open = data.document.status === 'DRAFT';
  const excessLines = data.lines.filter((line) => Number(line.diff_qty) > 0);

  return (
    <Page title={data.document.doc_number} back="/inventories">
      <ErrorBanner message={error} />

      <div className="card">
        <div className="row">
          <strong>{data.warehouse.code}</strong>
          <span className="muted">{data.document.business_date}</span>
        </div>
        <div className="row">
          <span className="muted">Саналды</span>
          <span>
            {data.counted_lines} / {data.total_lines}
          </span>
        </div>
        <div className="inline">
          {data.shortage_lines > 0 && (
            <span className="badge danger">Жетишпейт: {data.shortage_lines}</span>
          )}
          {data.excess_lines > 0 && (
            <span className="badge warn">Ашыкча: {data.excess_lines}</span>
          )}
        </div>
      </div>

      {data.lines.map((line) => (
        <CountRow
          key={line.id}
          line={line}
          editable={open}
          value={counts[line.id] ?? ''}
          onChange={(value) =>
            setCounts((rows) => ({ ...rows, [line.id]: value }))
          }
        />
      ))}

      {open && (
        <div className="card">
          <button type="button" onClick={save} disabled={busy}>
            {busy ? 'Сакталууда…' : 'Саноону сактоо'}
          </button>
        </div>
      )}

      {open && hasRole('OWNER') && (
        <div className="card">
          <h3 className="section-title">Корректировканы тастыктоо (§22)</h3>
          {excessLines.length > 0 && (
            <>
              <p className="muted" style={{ margin: 0 }}>
                Ашыкча табылган товардын наркын көрсөтүңүз — аны ЭЭСИ аныктайт.
              </p>
              {excessLines.map((line) => (
                <label key={line.id}>
                  {line.sku} — {line.diff_qty} даана ашыкча, бирдигинин наркы
                  <input
                    value={excess[line.id] ?? ''}
                    inputMode="decimal"
                    placeholder="0.0000"
                    onChange={(e) =>
                      setExcess((rows) => ({ ...rows, [line.id]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </>
          )}
          <button type="button" onClick={confirm} disabled={busy}>
            PIN менен тастыктоо
          </button>
          <p className="muted" style={{ margin: 0 }}>
            Жетишпеген товар кайсы LOT'тон экени белгилүү болсо ошондон, болбосо
            эң эски LOT'тон эсептен чыгат. Жоготуу бонус базасына кирбейт (§22).
          </p>
        </div>
      )}
    </Page>
  );
}

function CountRow({
  line,
  editable,
  value,
  onChange,
}: {
  line: InventoryLine;
  editable: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const diff = Number(line.diff_qty);

  return (
    <div className="card">
      <div className="row">
        <strong>{line.name}</strong>
        <span className="muted">{line.sku}</span>
      </div>
      <div className="row">
        <span className="muted">Системада</span>
        <span>{line.system_qty}</span>
      </div>
      {editable ? (
        <label>
          Фактический калдык
          <input
            value={value}
            inputMode="decimal"
            placeholder={line.actual_qty}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      ) : (
        <div className="row">
          <span className="muted">Факт</span>
          <span>{line.actual_qty}</span>
        </div>
      )}
      {diff !== 0 && (
        <div className="row">
          <span className="muted">Айырма</span>
          <Money value={line.diff_qty} className={diff < 0 ? 'negative' : ''} />
        </div>
      )}
    </div>
  );
}
