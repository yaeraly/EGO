import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type {
  CargoCompany,
  ProductAdvice,
  PurchaseAdviceReport,
} from '../api/types';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * What to order next (§33).
 *
 * Every line says why it reads as it does, because a suggestion nobody can
 * check is one nobody should follow. The quantities are the OWNER's to
 * change: §33 asks the system to suggest and the OWNER to decide.
 */
const PRIORITY: Record<string, { label: string; tone: string }> = {
  URGENT: { label: 'Шашылыш', tone: 'warn' },
  SOON: { label: 'Жакында', tone: 'neutral' },
  LATER: { label: 'Кийинчерээк', tone: 'neutral' },
  HOLD: { label: 'Күтө туруу', tone: 'ok' },
};

const LEAD_SOURCE: Record<string, string> = {
  MEASURED: 'келген партиялардан ченелди',
  SETTING: 'жөндөөдөн алынды — али бир да партия келе элек',
  UNKNOWN: 'белгисиз — али бир да партия келе элек',
};

export function PurchaseAdvicePage() {
  const report = useApi<PurchaseAdviceReport>('/reports/purchase-advice');
  const cargo = useApi<CargoCompany[]>('/cargo-companies');
  const navigate = useNavigate();

  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [cargoId, setCargoId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const data = report.data;

  /** What the OWNER has actually asked for, per supplier. */
  const chosen = useMemo(() => {
    const lines = (data?.order ?? [])
      .map((line) => ({
        line,
        qty: quantities[line.product_id] ?? line.suggested,
      }))
      .filter(({ qty }) => Number(qty) > 0);
    const bySupplier = new Map<string, typeof lines>();
    for (const entry of lines) {
      const key = entry.line.supplier_id ?? '';
      bySupplier.set(key, [...(bySupplier.get(key) ?? []), entry]);
    }
    return bySupplier;
  }, [data, quantities]);

  async function createOrder(supplierId: string) {
    const lines = chosen.get(supplierId) ?? [];
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/purchases', {
        method: 'POST',
        body: {
          supplier_id: supplierId,
          ...(cargoId ? { cargo_company_id: cargoId } : {}),
          items: lines.map(({ line, qty }) => ({
            product_id: line.product_id,
            qty: Number(qty).toFixed(2),
            price_cny: line.last_price_cny ?? '0.00',
          })),
        },
      });
      navigate(`/purchases/${document.id}`);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function Line({ line }: { line: ProductAdvice }) {
    const tone = PRIORITY[line.priority];
    return (
      <div className="card" key={line.product_id}>
        <div className="row">
          <strong>{line.name}</strong>
          <span className="inline">
            <span className={`badge ${tone.tone}`}>{tone.label}</span>
            <span className="badge neutral">{line.abc}</span>
            {line.xyz && <span className="badge neutral">{line.xyz}</span>}
          </span>
        </div>
        <div className="row">
          <span className="muted">
            {line.sku} · калдык {line.available} · жолдо {line.inbound}
          </span>
          <span className="muted">
            айына ~{line.monthly_rate} даана
            {line.cover_days ? ` · ${line.cover_days} күнгө жетет` : ''}
          </span>
        </div>
        {line.priority !== 'HOLD' && (
          <label>
            Заказ (сунуш {line.suggested})
            <input
              value={quantities[line.product_id] ?? line.suggested}
              inputMode="numeric"
              onChange={(e) =>
                setQuantities((current) => ({
                  ...current,
                  [line.product_id]: e.target.value,
                }))
              }
            />
          </label>
        )}
        <div className="row">
          <span className="muted">
            {line.last_price_cny
              ? `${line.last_price_cny} CNY/даана`
              : 'мурда сатып алынган эмес'}
          </span>
          <span className="muted">
            {line.estimated_cost_cny
              ? `~${line.estimated_cost_cny} CNY`
              : ''}
          </span>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {line.reason}
        </p>
      </div>
    );
  }

  return (
    <Page title="Сатып алуу жардамчысы (§33)">
      {report.loading && <Loading />}
      <ErrorBanner message={report.error} />
      <ErrorBanner message={error} />

      {data && (
        <div className="card">
          <div className="row">
            <span className="muted">{data.as_of}</span>
            <span className="muted">
              {data.window_days} күндүк сатуу · {data.cover_days} күнгө запас
            </span>
          </div>
          <div className="row">
            <span>Жеткирүү мөөнөтү</span>
            <strong>
              {data.lead_days === null ? '—' : `${data.lead_days} күн`}
            </strong>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {LEAD_SOURCE[data.lead_days_source]}
            {data.batches_measured > 0
              ? ` (${data.batches_measured} партия)`
              : ''}
          </p>
          <div className="row">
            <span>Болжолдуу заказдын баасы</span>
            <strong>{data.budget.estimated_cny} CNY</strong>
          </div>
          <div className="row">
            <span className="muted">CNY кассада бар</span>
            <span className="muted">{data.budget.available_cny}</span>
          </div>
          {Number(data.budget.shortfall_cny) > 0 && (
            <p className="banner warn" style={{ margin: 0 }}>
              Заказды толук төлөө үчүн дагы {data.budget.shortfall_cny} CNY
              керек — валюта сатып алуу (CEX) же заказды кыскартуу керек.
            </p>
          )}
        </div>
      )}

      {data && data.order.length === 0 && (
        <Empty text="Азырынча заказ кылуу керек болгон товар жок." />
      )}

      {(data?.order ?? []).map((line) => (
        <Line key={line.product_id} line={line} />
      ))}

      {data && chosen.size > 0 && (
        <div className="card">
          <h3 className="section-title">Заказ түзүү</h3>
          <label>
            Карго компаниясы
            <select value={cargoId} onChange={(e) => setCargoId(e.target.value)}>
              <option value="">—</option>
              {(cargo.data ?? []).map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          {[...chosen.entries()].map(([supplierId, lines]) => (
            <button
              key={supplierId || 'none'}
              type="button"
              disabled={busy || !supplierId}
              onClick={() => createOrder(supplierId)}
            >
              {supplierId
                ? `${lines[0].line.supplier_name ?? 'Поставщик'} — ${lines.length} позиция заказ кылуу`
                : `${lines.length} позициянын поставщиги белгисиз`}
            </button>
          ))}
          <p className="muted" style={{ margin: 0 }}>
            Заказ черновик болуп түзүлөт — тастыктаганга чейин баасын жана
            санын өзгөртө аласыз.
          </p>
        </div>
      )}

      {data && data.hold.length > 0 && (
        <>
          <div className="card">
            <h3 className="section-title">
              Азырынча керек эмес ({data.hold.length})
            </h3>
            <p className="muted" style={{ margin: 0 }}>
              Калдыгы же жолдогусу жетиштүү.
            </p>
          </div>
          {data.hold.map((line) => (
            <Line key={line.product_id} line={line} />
          ))}
        </>
      )}
    </Page>
  );
}
