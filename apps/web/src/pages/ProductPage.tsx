import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type {
  AliasKind,
  CompatibilityLink,
  ProductCard,
  ProductImage,
  VehicleModel,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { WAREHOUSE_TYPE_LABEL } from '../components/module3-labels';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { ProductGallery } from '../components/ProductImages';
import { useApi } from '../hooks/useApi';

const ALIAS_KIND_LABEL: Record<AliasKind, string> = {
  RU: 'орусча',
  KG: 'кыргызча',
  SUPPLIER: 'поставщик',
  KEYWORD: 'ачкыч сөз',
  OEM: 'OEM',
  OTHER: 'башка',
};

const WARRANTY_SOURCE_LABEL = {
  PRODUCT: 'товардын өзүндө',
  CATEGORY: 'категориядан (§12-Б.7)',
  NONE: 'коюлган эмес',
} as const;

/** The §12-Б card: what is stored, and everything derived from documents. */
export function ProductPage() {
  const { id = '' } = useParams();
  const { hasRole } = useAuth();
  const card = useApi<ProductCard>(id ? `/products/${id}/card` : null);
  const images = useApi<ProductImage[]>(id ? `/products/${id}/images` : null);

  if (card.loading) {
    return <Page title="Товар" back="/products"><Loading /></Page>;
  }
  if (!card.data) {
    return (
      <Page title="Товар" back="/products">
        <ErrorBanner message={card.error ?? 'Товар табылган жок'} />
      </Page>
    );
  }

  const { product, category, warranty, stock, layers, purchasing, pricing } = card.data;

  return (
    <Page
      title={product.name}
      back="/products"
      actions={
        hasRole('OWNER') ? (
          <Link to={`/products/${product.id}/edit`} className="badge neutral">
            Оңдоо
          </Link>
        ) : undefined
      }
    >
      <div className="card">
        <div className="row">
          <strong>{product.sku}</strong>
          {!product.is_active && <span className="badge danger">Пассив</span>}
        </div>
        <ProductGallery productId={product.id} images={images.data ?? []} />
        <Field label="Категория" value={category?.name ?? '—'} />
        <Field label="Бренд" value={product.brand ?? '—'} />
        <Field label="Бирдиги" value={product.unit} />
        <Field label="Barcode" value={product.barcode ?? '—'} />
        <Field label="OEM коду" value={product.oem_code ?? '—'} />
        <Field
          label="Кепилдик"
          value={`${warranty.days} күн — ${WARRANTY_SOURCE_LABEL[warranty.source]}`}
        />
        {product.description && <p className="muted">{product.description}</p>}
        {product.compatibility_notes && (
          <>
            <h3 className="section-title">Совместимость (§12-Б.8)</h3>
            <p className="muted">{product.compatibility_notes}</p>
          </>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Склад (§12-Б.4)</h3>
        <div className="row">
          <span>Бардыгы</span>
          <strong>{stock.current_qty}</strong>
        </div>
        <div className="row">
          <span>Сатууга жеткиликтүү</span>
          <strong>{stock.available_qty}</strong>
        </div>
        {stock.reserved_qty !== '0.00' && (
          <div className="row">
            <span>Бронь</span>
            <strong>{stock.reserved_qty}</strong>
          </div>
        )}
        <div className="row">
          <span>Жолдо (заказ кылынган, келе элек)</span>
          <strong>{stock.inbound_qty}</strong>
        </div>
        <div className="row">
          <span>Складдагы нарк</span>
          <Money value={stock.total_value_kgs} currency="KGS" />
        </div>
        <div className="row">
          <span className="muted">Минимум / кайра заказ чеги</span>
          <span className="muted">
            {stock.min_stock} / {stock.reorder_point}
          </span>
        </div>
        <div className="inline">
          {stock.below_minimum && (
            <span className="badge danger">Минимумдан төмөн</span>
          )}
          {stock.needs_reorder && (
            <span className="badge warn">Кайра заказ кылуу керек</span>
          )}
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Бул сандар документтерден эсептелет — кол менен өзгөртүлбөйт (§12-Б.9.3–5).
        </p>
        {stock.by_warehouse.map((warehouse) => (
          <div className="row" key={warehouse.warehouse_id}>
            <span className="muted">
              {warehouse.code} · {WAREHOUSE_TYPE_LABEL[warehouse.wtype]}
            </span>
            <span className="muted">{warehouse.qty}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="section-title">Активдүү FIFO LOT'тор (§18)</h3>
        {layers.length === 0 && <Empty text="Калдык жок." />}
        {layers.map((layer) => (
          <div className="row" key={`${layer.layer_id}-${layer.warehouse_id}`}>
            <span>
              {layer.layer_date} · {layer.warehouse_code}
              {layer.lot_number ? ` · ${layer.lot_number}` : ''}
            </span>
            <span>
              {layer.qty} × <Money value={layer.unit_cost} />
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="section-title">Баа (§12-Б.6)</h3>
        <div className="row">
          <span>Учурдагы FIFO өздүк нарк</span>
          {pricing.current_fifo_cost ? (
            <Money value={pricing.current_fifo_cost} currency="KGS" />
          ) : (
            <span className="muted">калдык жок</span>
          )}
        </div>
        <Field label="Базалык наценка" value={pricing.base_markup_pct ? `${pricing.base_markup_pct}%` : '—'} />
        <div className="row">
          <span>Минималдуу сатуу баасы (§13.2)</span>
          {pricing.min_selling_price ? (
            <Money value={pricing.min_selling_price} currency="KGS" />
          ) : (
            <span className="muted">—</span>
          )}
        </div>
        {pricing.indicative_price && (
          <div className="row">
            <span>Болжолдуу баа</span>
            <Money value={pricing.indicative_price} currency="KGS" />
          </div>
        )}
        <p className="muted" style={{ margin: 0 }}>
          Болжолдуу баа — товардын өз наценкасы гана. Кардардын Type × Category
          наценкасы сатуу экранында кошулат (§13).
        </p>
      </div>

      <div className="card">
        <h3 className="section-title">Сатып алуу (§12-Б.5)</h3>
        <Field label="Негизги поставщик" value={purchasing.main_supplier?.name ?? '—'} />
        <Field label="Поставщиктин коду" value={purchasing.supplier_product_code ?? '—'} />
        {purchasing.last_purchase ? (
          <>
            <div className="row">
              <span>Акыркы сатып алуу баасы</span>
              <Money value={purchasing.last_purchase.price_cny} currency="CNY" />
            </div>
            <div className="row">
              <span className="muted">
                {purchasing.last_purchase.doc_number} ·{' '}
                {purchasing.last_purchase.business_date}
              </span>
              <span className="muted">{purchasing.last_purchase.qty} даана</span>
            </div>
          </>
        ) : (
          <Empty text="Тастыкталган заказ жок." />
        )}
        <Field label="Акыркы приход" value={purchasing.last_receipt_date ?? '—'} />
      </div>

      <Compatibility productId={product.id} isOwner={hasRole('OWNER')} />

      <Aliases
        productId={product.id}
        aliases={card.data.aliases}
        editable={hasRole('OWNER')}
        onChange={card.reload}
      />
    </Page>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * §12-Б.8 — which tricycle models this part fits.
 *
 * Anyone at the counter may record a fit, because they are the ones who find
 * out; only the OWNER can mark it checked, because VERIFIED is the shop's
 * word to a customer.
 */
function Compatibility({
  productId,
  isOwner,
}: {
  productId: string;
  isOwner: boolean;
}) {
  const links = useApi<CompatibilityLink[]>(
    `/products/${productId}/compatibility`,
  );
  const models = useApi<VehicleModel[]>('/vehicle-models');
  const [modelId, setModelId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const linked = new Set((links.data ?? []).map((row) => row.model_id));

  async function act(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
      links.reload();
      models.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div className="card">
      <h3 className="section-title">Кайсы моделдерге туура келет (§12-Б.8)</h3>
      <ErrorBanner message={error} />
      {links.data?.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Азырынча бир да модель байланышкан эмес.
        </p>
      )}

      {(links.data ?? []).map((row) => (
        <div className="row" key={row.model_id}>
          <span>
            {[row.brand, row.model_name].filter(Boolean).join(' ')}
            {row.note && <span className="muted"> · {row.note}</span>}
          </span>
          <span className="inline">
            <span className={`badge ${row.status === 'VERIFIED' ? 'ok' : 'neutral'}`}>
              {row.status === 'VERIFIED'
                ? `текшерилди · ${row.verified_by_name ?? ''}`
                : 'текшерилген жок'}
            </span>
            {isOwner && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  act(() =>
                    api(
                      `/products/${productId}/compatibility/${row.model_id}/verify`,
                      { method: row.status === 'VERIFIED' ? 'DELETE' : 'POST' },
                    ),
                  )
                }
              >
                {row.status === 'VERIFIED' ? 'Белгини алуу' : 'Текшердим'}
              </button>
            )}
            <button
              type="button"
              className="danger"
              onClick={() =>
                act(() =>
                  api(`/products/${productId}/compatibility/${row.model_id}`, {
                    method: 'DELETE',
                  }),
                )
              }
            >
              Өчүрүү
            </button>
          </span>
        </div>
      ))}

      <form
        className="inline"
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            await api(`/products/${productId}/compatibility`, {
              method: 'POST',
              body: {
                model_id: modelId,
                ...(note.trim() ? { note: note.trim() } : {}),
              },
            });
            setModelId('');
            setNote('');
          });
        }}
      >
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          required
        >
          <option value="">Модель тандаңыз</option>
          {(models.data ?? [])
            .filter((model) => !linked.has(model.id))
            .map((model) => (
              <option key={model.id} value={model.id}>
                {[model.brand, model.name].filter(Boolean).join(' ')}
              </option>
            ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="эскертүү"
        />
        <button type="submit" disabled={!modelId}>
          Кошуу
        </button>
      </form>
    </div>
  );
}

/** §12-Б.2 — the other names this part goes by, and what search reads. */
function Aliases({
  productId,
  aliases,
  editable,
  onChange,
}: {
  productId: string;
  aliases: ProductCard['aliases'];
  editable: boolean;
  onChange: () => void;
}) {
  const [alias, setAlias] = useState('');
  const [kind, setKind] = useState<AliasKind>('RU');
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api(`/products/${productId}/aliases`, {
        method: 'POST',
        body: { alias: alias.trim(), kind },
      });
      setAlias('');
      onChange();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function remove(aliasId: string) {
    setError(null);
    try {
      await api(`/products/${productId}/aliases/${aliasId}`, { method: 'DELETE' });
      onChange();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div className="card">
      <h3 className="section-title">Альтернативдүү аталыштар (§12-Б.2)</h3>
      <p className="muted" style={{ margin: 0 }}>
        Издөө ушулар боюнча да иштейт (§12-Б.9.6).
      </p>

      <ErrorBanner message={error} />
      {aliases.length === 0 && <Empty text="Кошумча ат жок." />}

      {aliases.map((row) => (
        <div className="row" key={row.id}>
          <span>
            {row.alias}{' '}
            <span className="badge neutral">{ALIAS_KIND_LABEL[row.kind]}</span>
          </span>
          {editable && (
            <button type="button" className="danger" onClick={() => remove(row.id)}>
              Өчүрүү
            </button>
          )}
        </div>
      ))}

      {editable && (
        <form className="inline" onSubmit={add}>
          <input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="двигатель"
            required
          />
          <select value={kind} onChange={(e) => setKind(e.target.value as AliasKind)}>
            {(Object.keys(ALIAS_KIND_LABEL) as AliasKind[]).map((value) => (
              <option key={value} value={value}>
                {ALIAS_KIND_LABEL[value]}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!alias.trim()}>
            Кошуу
          </button>
        </form>
      )}
    </div>
  );
}
