import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { Category, Product, Supplier } from '../api/types';
import { ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/** Every field the form writes, kept as the strings the API expects. */
interface Draft {
  name: string;
  category_id: string;
  brand: string;
  unit: string;
  purchase_price_cny: string;
  oem_code: string;
  description: string;
  compatibility_notes: string;
  warranty_days: string;
  weight_kg: string;
  length_cm: string;
  width_cm: string;
  height_cm: string;
  volume_m3: string;
  chargeable_weight_kg: string;
  min_stock: string;
  reorder_point: string;
  base_markup_pct: string;
  min_selling_price: string;
  main_supplier_id: string;
  supplier_product_code: string;
  is_active: boolean;
}

const EMPTY: Draft = {
  name: '',
  category_id: '',
  brand: '',
  unit: 'даана',
  purchase_price_cny: '',
  oem_code: '',
  description: '',
  compatibility_notes: '',
  warranty_days: '',
  weight_kg: '',
  length_cm: '',
  width_cm: '',
  height_cm: '',
  volume_m3: '',
  chargeable_weight_kg: '',
  min_stock: '0',
  reorder_point: '0',
  base_markup_pct: '',
  min_selling_price: '',
  main_supplier_id: '',
  supplier_product_code: '',
  is_active: true,
};

/**
 * Product card, create and edit (§12-Б.1–.8).
 *
 * The SKU and the barcode are not on this form at all: the system issues both
 * (§12-Б.9.1). A code typed by hand is eventually mistyped or repeated, and
 * neither shows up until a receipt or a sale reaches the wrong part. They are
 * shown on the product's own card once it exists.
 *
 * The order of the fields is the order the person filling it in knows the
 * answers: what it is, what it weighs, what it costs in China — then the
 * details that can wait.
 */
export function ProductFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);

  const categories = useApi<Category[]>('/categories');
  const suppliers = useApi<Supplier[]>('/suppliers');
  const existing = useApi<Product>(id ? `/products/${id}` : null);

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The select elements need their options before a preselected value sticks,
  // so the draft is filled only once the lists and the product are all in.
  const ready =
    !categories.loading && !suppliers.loading && (!editing || Boolean(existing.data));

  useEffect(() => {
    if (!existing.data) return;
    setDraft(toDraft(existing.data));
  }, [existing.data]);

  const set = (field: keyof Draft) => (value: string | boolean) =>
    setDraft((current) => ({ ...current, [field]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = toBody(draft, editing);
      if (editing) {
        await api(`/products/${id}`, { method: 'PATCH', body });
        navigate(`/products/${id}`);
      } else {
        const created = await api<Product>('/products', { method: 'POST', body });
        navigate(`/products/${created.id}`);
      }
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <Page title={editing ? 'Товарды оңдоо' : 'Жаңы товар'} back="/products">
        <Loading />
      </Page>
    );
  }

  return (
    <Page
      title={editing ? 'Товарды оңдоо' : 'Жаңы товар'}
      back={editing ? `/products/${id}` : '/products'}
    >
      <form className="card" onSubmit={submit}>
        <ErrorBanner message={error} />

        <label>
          Аталышы
          <input
            value={draft.name}
            onChange={(e) => set('name')(e.target.value)}
            required
          />
        </label>
        <label>
          Салмагы (кг)
          <input
            value={draft.weight_kg}
            inputMode="decimal"
            onChange={(e) => set('weight_kg')(e.target.value)}
            required
          />
        </label>
        <p className="muted" style={{ margin: 0 }}>
          Салмагы жок товар менен приход тастыкталбайт (§9.1).
        </p>
        <label>
          Категория
          <select
            value={draft.category_id}
            onChange={(e) => set('category_id')(e.target.value)}
          >
            <option value="">—</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.code ? ` (${category.code}-…)` : ''} ·{' '}
                {category.default_warranty_days} күн кепилдик
              </option>
            ))}
          </select>
        </label>
        <label>
          Өлчөө бирдиги
          <input value={draft.unit} onChange={(e) => set('unit')(e.target.value)} />
        </label>
        <label>
          Кытайдагы баасы (CNY)
          <input
            value={draft.purchase_price_cny}
            inputMode="decimal"
            placeholder="0.00"
            onChange={(e) => set('purchase_price_cny')(e.target.value)}
          />
        </label>
        <p className="muted" style={{ margin: 0 }}>
          Сатып алуу жардамчысы (§33) заказдын наркын ушуну менен эсептейт.
          Чыныгы заказ болгондон кийин акыркы факт баа колдонулат (§12-Б.5).
        </p>

        {!editing && (
          <p className="banner ok" style={{ margin: 0 }}>
            SKU менен штрихкодду система өзү берет — кол менен терилбейт
            (§12-Б.9.1).
          </p>
        )}

        <h3 className="section-title">Кошумча маалымат</h3>
        <label>
          OEM / Factory коду
          <input
            value={draft.oem_code}
            onChange={(e) => set('oem_code')(e.target.value)}
          />
        </label>
        <label>
          Бренд
          <input value={draft.brand} onChange={(e) => set('brand')(e.target.value)} />
        </label>
        <div className="inline">
          <label>
            Узундугу (см)
            <input
              value={draft.length_cm}
              inputMode="decimal"
              onChange={(e) => set('length_cm')(e.target.value)}
            />
          </label>
          <label>
            Туурасы (см)
            <input
              value={draft.width_cm}
              inputMode="decimal"
              onChange={(e) => set('width_cm')(e.target.value)}
            />
          </label>
          <label>
            Бийиктиги (см)
            <input
              value={draft.height_cm}
              inputMode="decimal"
              onChange={(e) => set('height_cm')(e.target.value)}
            />
          </label>
        </div>
        <label>
          Көлөмү (м³)
          <input
            value={draft.volume_m3}
            inputMode="decimal"
            onChange={(e) => set('volume_m3')(e.target.value)}
          />
        </label>
        <label>
          Эсептик салмак (кг) — карго ушуну боюнча эсептесе
          <input
            value={draft.chargeable_weight_kg}
            inputMode="decimal"
            onChange={(e) => set('chargeable_weight_kg')(e.target.value)}
          />
        </label>

        <h3 className="section-title">Склад чектери (§12-Б.4)</h3>
        <div className="inline">
          <label>
            Минимум калдык
            <input
              value={draft.min_stock}
              inputMode="decimal"
              onChange={(e) => set('min_stock')(e.target.value)}
            />
          </label>
          <label>
            Кайра заказ чеги
            <input
              value={draft.reorder_point}
              inputMode="decimal"
              onChange={(e) => set('reorder_point')(e.target.value)}
            />
          </label>
        </div>

        <h3 className="section-title">Баа (§12-Б.6, §13)</h3>
        <div className="inline">
          <label>
            Базалык наценка (%)
            <input
              value={draft.base_markup_pct}
              inputMode="decimal"
              onChange={(e) => set('base_markup_pct')(e.target.value)}
            />
          </label>
          <label>
            Минималдуу сатуу баасы
            <input
              value={draft.min_selling_price}
              inputMode="decimal"
              onChange={(e) => set('min_selling_price')(e.target.value)}
            />
          </label>
        </div>

        <h3 className="section-title">Сатып алуу (§12-Б.5)</h3>
        <label>
          Негизги поставщик
          <select
            value={draft.main_supplier_id}
            onChange={(e) => set('main_supplier_id')(e.target.value)}
          >
            <option value="">—</option>
            {(suppliers.data ?? []).map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Поставщиктин товар коду
          <input
            value={draft.supplier_product_code}
            onChange={(e) => set('supplier_product_code')(e.target.value)}
          />
        </label>

        <h3 className="section-title">Кепилдик жана сүрөттөмө</h3>
        <label>
          Кепилдик (күн) — бош калса категориянын демейкиси (§12-Б.7)
          <input
            value={draft.warranty_days}
            inputMode="numeric"
            onChange={(e) => set('warranty_days')(e.target.value)}
          />
        </label>
        <label>
          Сүрөттөмө
          <textarea
            value={draft.description}
            rows={2}
            onChange={(e) => set('description')(e.target.value)}
          />
        </label>
        <label>
          Совместимость (§12-Б.8)
          <textarea
            value={draft.compatibility_notes}
            rows={2}
            placeholder="Кайсы трицикл моделдерине туура келет"
            onChange={(e) => set('compatibility_notes')(e.target.value)}
          />
        </label>

        {editing && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(e) => set('is_active')(e.target.checked)}
            />
            Активдүү
          </label>
        )}

        <button
          type="submit"
          disabled={busy || !draft.name.trim() || !draft.weight_kg.trim()}
        >
          {busy ? 'Сакталууда…' : 'Сактоо'}
        </button>
      </form>
    </Page>
  );
}

function toDraft(product: Product): Draft {
  return {
    name: product.name,
    category_id: product.category_id ?? '',
    brand: product.brand ?? '',
    unit: product.unit,
    purchase_price_cny: product.purchase_price_cny ?? '',
    oem_code: product.oem_code ?? '',
    description: product.description ?? '',
    compatibility_notes: product.compatibility_notes ?? '',
    warranty_days: product.warranty_days === null ? '' : String(product.warranty_days),
    weight_kg: product.weight_kg ?? '',
    length_cm: product.length_cm ?? '',
    width_cm: product.width_cm ?? '',
    height_cm: product.height_cm ?? '',
    volume_m3: product.volume_m3 ?? '',
    chargeable_weight_kg: product.chargeable_weight_kg ?? '',
    min_stock: product.min_stock,
    reorder_point: product.reorder_point,
    base_markup_pct: product.base_markup_pct ?? '',
    min_selling_price: product.min_selling_price ?? '',
    main_supplier_id: product.main_supplier_id ?? '',
    supplier_product_code: product.supplier_product_code ?? '',
    is_active: product.is_active,
  };
}

/**
 * Only what the person filled in.
 *
 * An empty field is left out rather than sent as an empty string: the API
 * validates decimals by pattern, and "" is not a decimal. On an edit that
 * also means an untouched field keeps whatever is stored.
 */
function toBody(draft: Draft, editing: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: draft.name.trim(),
    unit: draft.unit.trim() || 'даана',
  };
  if (editing) {
    body.is_active = draft.is_active;
  }

  const text: (keyof Draft)[] = [
    'brand',
    'oem_code',
    'description',
    'compatibility_notes',
    'supplier_product_code',
  ];
  for (const field of text) {
    const value = String(draft[field]).trim();
    if (value) body[field] = value;
  }

  const decimals: (keyof Draft)[] = [
    'weight_kg',
    'length_cm',
    'width_cm',
    'height_cm',
    'volume_m3',
    'chargeable_weight_kg',
    'min_stock',
    'reorder_point',
    'base_markup_pct',
    'min_selling_price',
    'purchase_price_cny',
  ];
  for (const field of decimals) {
    const value = String(draft[field]).trim();
    if (value) body[field] = value;
  }

  if (draft.category_id) body.category_id = draft.category_id;
  if (draft.main_supplier_id) body.main_supplier_id = draft.main_supplier_id;
  if (draft.warranty_days.trim()) {
    body.warranty_days = Number(draft.warranty_days.trim());
  }

  return body;
}
