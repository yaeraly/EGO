import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type {
  AccountBalance,
  CreditStanding,
  Customer,
  PriceSuggestion,
  ProductStock,
  SaleAssessment,
} from '../api/types';
import { Money } from '../components/Money';
import { ErrorBanner, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

interface Basket {
  productId: string;
  sku: string;
  name: string;
  qty: string;
  autoPrice: string;
  finalPrice: string;
  reason: string;
  available: string;
}

/**
 * The sale screen (§14) — the one used most, so §1 governs it: one screen,
 * one task, as few taps as it can be done in.
 *
 * The ordinary sale is a straight line down the page: pick the customer,
 * scan or find the goods, take the money, confirm. Everything that is not
 * ordinary — a discount, a debt, a PIN — appears only when it applies.
 */
export function SellPage() {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [basket, setBasket] = useState<Basket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const walkIn = useApi<Customer>('/customers/walk-in');
  const accounts = useApi<AccountBalance[]>('/accounts/balances');

  // Walk-in is the default: most retail sales are to nobody in particular.
  useEffect(() => {
    if (!customer && walkIn.data) {
      setCustomer(walkIn.data);
    }
  }, [walkIn.data, customer]);

  const credit = useApi<CreditStanding>(
    customer && !customer.is_walk_in ? `/sales/credit/${customer.id}` : null,
  );

  const total = useMemo(
    () =>
      basket
        .reduce(
          (sum, line) => sum + Number(line.finalPrice) * Number(line.qty || '0'),
          0,
        )
        .toFixed(2),
    [basket],
  );

  async function startSale() {
    if (!customer || basket.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/sales', {
        method: 'POST',
        body: {
          customer_id: customer.id,
          items: basket.map((line) => ({
            product_id: line.productId,
            qty: line.qty,
            final_price: line.finalPrice,
            ...(line.reason.trim() ? { discount_reason: line.reason.trim() } : {}),
          })),
        },
      });
      navigate(`/sell/${document.id}`);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Сатуу">
      <CustomerPicker
        customer={customer}
        credit={credit.data}
        onPick={(picked) => {
          setCustomer(picked);
          // Prices depend on the customer, so the basket is repriced.
          setBasket([]);
        }}
      />

      <ProductPicker
        customerId={customer?.id ?? null}
        onAdd={(line) =>
          setBasket((rows) => {
            const existing = rows.find((row) => row.productId === line.productId);
            return existing
              ? rows.map((row) =>
                  row.productId === line.productId
                    ? { ...row, qty: String(Number(row.qty) + 1) }
                    : row,
                )
              : [...rows, line];
          })
        }
      />

      {basket.length > 0 && (
        <div className="card">
          <h3 className="section-title">Себет</h3>
          {basket.map((line, index) => (
            <BasketLine
              key={line.productId}
              line={line}
              onChange={(next) =>
                setBasket((rows) =>
                  rows.map((row, i) => (i === index ? next : row)),
                )
              }
              onRemove={() =>
                setBasket((rows) => rows.filter((_, i) => i !== index))
              }
            />
          ))}

          <div className="row">
            <strong>Жалпы</strong>
            <Money value={total} currency="KGS" className="big" />
          </div>
        </div>
      )}

      <ErrorBanner message={error ?? accounts.error} />

      <button
        disabled={busy || !customer || basket.length === 0}
        onClick={startSale}
      >
        {busy ? 'Түзүлүүдө…' : 'Төлөмгө өтүү'}
      </button>
    </Page>
  );
}

/** Step 1 — the customer, with everything §16.6 asks for. */
function CustomerPicker({
  customer,
  credit,
  onPick,
}: {
  customer: Customer | null;
  credit: CreditStanding | null;
  onPick: (customer: Customer) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useApi<Customer[]>(
    query.trim().length >= 2 ? `/customers?q=${encodeURIComponent(query.trim())}` : null,
  );
  const walkIn = useApi<Customer>('/customers/walk-in');

  return (
    <div className="card">
      <h3 className="section-title">Кардар</h3>

      {customer && (
        <div className="row">
          <strong>{customer.name}</strong>
          <span className="inline">
            <span className="badge neutral">{customer.ctype}</span>
            {!customer.is_walk_in && (
              <span className="badge info">{customer.category}</span>
            )}
          </span>
        </div>
      )}

      {credit && (
        <div className={`banner ${credit.has_overdue ? 'warn' : 'info'}`}>
          <div className="row">
            <span>Лимит</span>
            <span>
              {credit.effective_credit_limit ? (
                <Money value={credit.effective_credit_limit} currency="KGS" />
              ) : (
                'коюла элек'
              )}
            </span>
          </div>
          <div className="row">
            <span>Учурдагы карыз</span>
            <Money value={credit.current_open_debt} currency="KGS" />
          </div>
          <div className="row">
            <span>Жеткиликтүү кредит</span>
            <Money value={credit.available_credit} currency="KGS" />
          </div>
          {credit.has_overdue && (
            <div>
              Мөөнөтү өткөн: <Money value={credit.overdue_amount} /> — карызга
              сатуу блокторлот (§16.4)
            </div>
          )}
          {credit.oldest_unpaid_due_date && (
            <div className="muted">
              Эң эски карыздын мөөнөтү: {credit.oldest_unpaid_due_date}
            </div>
          )}
        </div>
      )}

      <label>
        Издөө (аты же телефон)
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Азамат же 0555…"
        />
      </label>

      {(results.data ?? []).length > 0 && (
        <div className="lines">
          {(results.data ?? []).map((found) => (
            <button
              key={found.id}
              className="secondary line"
              style={{ textAlign: 'left' }}
              onClick={() => {
                onPick(found);
                setQuery('');
              }}
            >
              <span>{found.name}</span>
              <span className="muted">{found.phone ?? '—'}</span>
            </button>
          ))}
        </div>
      )}

      {walkIn.data && customer?.id !== walkIn.data.id && (
        <button className="link" onClick={() => onPick(walkIn.data!)}>
          Катталбаган кардар (Walk-in)
        </button>
      )}
    </div>
  );
}

/** Step 2 — the goods. Search by SKU, name or barcode (§12-Б.2). */
function ProductPicker({
  customerId,
  onAdd,
}: {
  customerId: string | null;
  onAdd: (line: Basket) => void;
}) {
  const [query, setQuery] = useState('');
  const stock = useApi<ProductStock[]>('/stock');
  const [error, setError] = useState<string | null>(null);

  const matches = (stock.data ?? []).filter((entry) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return false;
    return (
      entry.sku.toLowerCase().includes(needle) ||
      entry.name.toLowerCase().includes(needle)
    );
  });

  async function add(entry: ProductStock) {
    if (!customerId) return;
    setError(null);
    try {
      const price = await api<PriceSuggestion>(
        `/pricing/suggest?product_id=${entry.product_id}&customer_id=${customerId}`,
      );
      onAdd({
        productId: entry.product_id,
        sku: entry.sku,
        name: entry.name,
        qty: '1',
        autoPrice: price.auto_price,
        finalPrice: price.auto_price,
        reason: '',
        available: entry.available_qty,
      });
      setQuery('');
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div className="card">
      <h3 className="section-title">Товар</h3>
      <ErrorBanner message={error} />
      <label>
        Издөө (SKU, аты, штрихкод)
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="MOT-1800"
          inputMode="search"
        />
      </label>

      <div className="lines">
        {matches.slice(0, 8).map((entry) => (
          <button
            key={entry.product_id}
            className="secondary line"
            style={{ textAlign: 'left' }}
            disabled={Number(entry.available_qty) <= 0}
            onClick={() => add(entry)}
          >
            <span>
              {entry.name}
              <div className="muted">{entry.sku}</div>
            </span>
            <span className="muted">калдык {entry.available_qty}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BasketLine({
  line,
  onChange,
  onRemove,
}: {
  line: Basket;
  onChange: (line: Basket) => void;
  onRemove: () => void;
}) {
  const discounted = Number(line.finalPrice) < Number(line.autoPrice);

  return (
    <div className="line" style={{ display: 'block' }}>
      <div className="row">
        <strong>{line.name}</strong>
        <button className="link" onClick={onRemove}>
          Өчүрүү
        </button>
      </div>
      <div className="inline">
        <label style={{ flex: 1 }}>
          Саны
          <input
            value={line.qty}
            inputMode="decimal"
            onChange={(e) => onChange({ ...line, qty: e.target.value })}
          />
        </label>
        <label style={{ flex: 1 }}>
          Баа
          <input
            value={line.finalPrice}
            inputMode="decimal"
            onChange={(e) => onChange({ ...line, finalPrice: e.target.value })}
          />
        </label>
      </div>
      <div className="muted">
        Сунушталган баа <Money value={line.autoPrice} /> · калдык {line.available}
      </div>
      {discounted && (
        <label>
          Скидканын себеби (милдеттүү — §13.8)
          <input
            value={line.reason}
            onChange={(e) => onChange({ ...line, reason: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}
