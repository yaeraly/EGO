import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type {
  AllocBasis,
  CostingPreview,
  CurrencyCode,
  ExpenseType,
  RateSuggestion,
  Receipt,
  ReceiptProblem,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { ErrorBanner, Loading, Page } from '../components/Page';
import {
  BASIS_HINT,
  BASIS_LABEL,
  EXPENSE_LABEL,
  RECEIPT_STATUS_LABEL,
  receiptStatusTone,
} from '../components/module3-labels';
import { useApi } from '../hooks/useApi';

const STEPS = [
  '1. Факт сандар',
  '2. Чыгымдар',
  '3. Курстар',
  '4. Текшерүү',
  '5. Тастыктоо',
] as const;

/**
 * The receipt wizard (§2.8, §7).
 *
 * Five steps in the order the work actually happens at the warehouse door:
 * count what came, list what it cost to get here, fix the rates, look at the
 * unit costs this produces, and only then commit. Step 4 is the one that
 * matters — after confirmation the landed cost never changes (§18.1.6.3).
 */
export function ReceiptWizardPage() {
  const { id = '' } = useParams();
  const [step, setStep] = useState(0);
  const receipt = useApi<Receipt>(`/receipts/${id}`);
  const problems = useApi<ReceiptProblem[]>(`/receipts/${id}/problems`);

  const reloadAll = () => {
    receipt.reload();
    problems.reload();
  };

  if (receipt.loading) {
    return <Page title="Приход" back="/receipts"><Loading /></Page>;
  }
  if (receipt.error || !receipt.data) {
    return (
      <Page title="Приход" back="/receipts">
        <ErrorBanner message={receipt.error ?? 'Табылган жок'} />
      </Page>
    );
  }

  const data = receipt.data;
  const locked = data.rstatus === 'RECEIVED' || data.rstatus === 'CLOSED';

  return (
    <Page title="Приход (RCV)" back="/receipts">
      <div className="card">
        <div className="inline">
          <span className={`badge ${receiptStatusTone(data.rstatus)}`}>
            {RECEIPT_STATUS_LABEL[data.rstatus]}
          </span>
          <Link to={`/purchases/${data.purchase_id}`}>Заказды ачуу</Link>
        </div>
        {locked && (
          <p className="banner ok">
            Приход тастыкталды. Өздүк нарк бекитилди жана мындан ары
            өзгөрбөйт (§18.1.6.3). Оңдоо керек болсо — COR документи.
          </p>
        )}
      </div>

      {!locked && (
        <nav className="inline" style={{ overflowX: 'auto' }}>
          {STEPS.map((label, index) => (
            <button
              key={label}
              className={index === step ? '' : 'secondary'}
              style={{ minHeight: 38, padding: '6px 10px', fontSize: '0.8rem' }}
              onClick={() => setStep(index)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {step === 0 && <LinesStep receipt={data} locked={locked} onSaved={reloadAll} />}
      {step === 1 && <ExpensesStep receipt={data} locked={locked} onSaved={reloadAll} />}
      {step === 2 && <RatesStep receipt={data} locked={locked} onSaved={reloadAll} />}
      {step === 3 && <PreviewStep receiptId={id} problems={problems.data ?? []} />}
      {step === 4 && (
        <ConfirmStep
          receipt={data}
          problems={problems.data ?? []}
          locked={locked}
          onConfirmed={reloadAll}
        />
      )}
    </Page>
  );
}

/** Step 1 — what actually arrived, with the order alongside (§8.1, §8.4). */
function LinesStep({
  receipt,
  locked,
  onSaved,
}: {
  receipt: Receipt;
  locked: boolean;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState(() =>
    receipt.receipt_items.map((item) => ({
      product_id: item.product_id,
      sku: item.products.sku,
      name: item.products.name,
      ordered: item.ordered_qty,
      received: item.received_qty,
      damaged: item.damaged_qty,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (index: number, field: 'received' | 'damaged', value: string) =>
    setLines((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/receipts/${receipt.document_id}/lines`, {
        method: 'POST',
        body: {
          lines: lines.map((row) => ({
            product_id: row.product_id,
            received_qty: row.received,
            damaged_qty: row.damaged,
          })),
        },
      });
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <h3 className="section-title">Фактически кабыл алынган сан</h3>
      <ErrorBanner message={error} />
      <p className="muted" style={{ margin: 0 }}>
        Заказ жанында турат. Приход факт боюнча таанылат — жетпеген товардын
        наркы келгендердин өздүк наркына кошулбайт (§8.1).
      </p>

      {lines.map((row, index) => (
        <div key={row.product_id} className="line" style={{ display: 'block' }}>
          <div className="row">
            <strong>{row.name}</strong>
            <span className="muted">{row.sku}</span>
          </div>
          <div className="inline">
            <label style={{ flex: 1 }}>
              Заказ
              <input value={row.ordered} disabled />
            </label>
            <label style={{ flex: 1 }}>
              Келди
              <input
                value={row.received}
                inputMode="decimal"
                disabled={locked}
                onChange={(e) => set(index, 'received', e.target.value)}
              />
            </label>
            <label style={{ flex: 1 }}>
              Брак
              <input
                value={row.damaged}
                inputMode="decimal"
                disabled={locked}
                onChange={(e) => set(index, 'damaged', e.target.value)}
              />
            </label>
          </div>
          {row.damaged !== '0' && row.damaged !== '' && (
            <p className="muted" style={{ margin: 0 }}>
              Брак товар DEFECT складга кирет, ошол эле өздүк нарк менен (§8.4).
            </p>
          )}
        </div>
      ))}

      {!locked && (
        <button type="submit" disabled={busy}>
          {busy ? 'Сакталууда…' : 'Сактоо'}
        </button>
      )}
    </form>
  );
}

const EXPENSE_TYPES = Object.keys(EXPENSE_LABEL) as ExpenseType[];
const BASES = Object.keys(BASIS_LABEL) as AllocBasis[];

/** Step 2 — direct expenses, each with its own basis (§5, §9.2). */
function ExpensesStep({
  receipt,
  locked,
  onSaved,
}: {
  receipt: Receipt;
  locked: boolean;
  onSaved: () => void;
}) {
  const [etype, setEtype] = useState<ExpenseType>('INTL_CARGO');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('KGS');
  const [rate, setRate] = useState('');
  const [basis, setBasis] = useState<AllocBasis>('WEIGHT');
  const [isPaid, setIsPaid] = useState(false);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/receipts/${receipt.document_id}/expenses`, {
        method: 'POST',
        body: {
          etype,
          amount: amount.trim(),
          currency,
          ...(currency !== 'KGS' && rate.trim() ? { rate: rate.trim() } : {}),
          alloc_basis: basis,
          is_paid: isPaid,
          ...(basis === 'MANUAL'
            ? {
                manual_allocations: receipt.receipt_items.map((item) => ({
                  receipt_item_id: item.id,
                  amount_kgs: manual[item.id] ?? '0.00',
                })),
              }
            : {}),
        },
      });
      setAmount('');
      setRate('');
      setManual({});
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(expenseId: string) {
    setError(null);
    try {
      await api(`/receipts/${receipt.document_id}/expenses/${expenseId}`, {
        method: 'POST',
      }).catch(async () => {
        await fetch(
          `/api/receipts/${receipt.document_id}/expenses/${expenseId}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${localStorage.getItem('egomot.token')}`,
              'Idempotency-Key': crypto.randomUUID(),
            },
          },
        );
      });
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  const total = receipt.receipt_expenses.reduce(
    (sum, expense) => sum + Number(expense.kgs_amount),
    0,
  );

  return (
    <>
      <div className="card">
        <h3 className="section-title">Түз чыгымдар</h3>
        {receipt.receipt_expenses.length === 0 && (
          <p className="muted">Чыгым жок.</p>
        )}
        <div className="lines">
          {receipt.receipt_expenses.map((expense) => (
            <div className="line" key={expense.id}>
              <div>
                <div>{EXPENSE_LABEL[expense.etype]}</div>
                <div className="muted">
                  {BASIS_LABEL[expense.alloc_basis]}
                  {expense.currency !== 'KGS' &&
                    ` · ${expense.amount} ${expense.currency} × ${expense.rate} (${expense.rate_source})`}
                  {expense.is_paid ? ' · төлөнгөн' : ' · карыз'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Money value={expense.kgs_amount} currency="KGS" />
                {!locked && (
                  <div>
                    <button className="link" onClick={() => remove(expense.id)}>
                      Өчүрүү
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {receipt.receipt_expenses.length > 0 && (
          <div className="row">
            <strong>Жалпы</strong>
            <Money value={total.toFixed(2)} currency="KGS" />
          </div>
        )}
      </div>

      {!locked && (
        <form className="card" onSubmit={add}>
          <h3 className="section-title">Чыгым кошуу</h3>
          <ErrorBanner message={error} />

          <label>
            Түрү
            <select value={etype} onChange={(e) => setEtype(e.target.value as ExpenseType)}>
              {EXPENSE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EXPENSE_LABEL[type]}
                </option>
              ))}
            </select>
          </label>

          <div className="inline">
            <label style={{ flex: 2 }}>
              Сумма
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                required
              />
            </label>
            <label style={{ flex: 1 }}>
              Валюта
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              >
                <option value="KGS">KGS</option>
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
              </select>
            </label>
          </div>

          {currency !== 'KGS' && (
            <label>
              Курс (1 {currency} канча сом) — бош калтырсаңыз система сунуштайт (§10.1)
              <input
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                inputMode="decimal"
                placeholder="87.00"
              />
            </label>
          )}

          <label>
            Бөлүштүрүү базасы
            <select value={basis} onChange={(e) => setBasis(e.target.value as AllocBasis)}>
              {BASES.map((option) => (
                <option key={option} value={option}>
                  {BASIS_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          <p className="muted" style={{ margin: 0 }}>{BASIS_HINT[basis]}</p>

          {basis === 'MANUAL' && (
            <>
              {receipt.receipt_items.map((item) => (
                <label key={item.id}>
                  {item.products.name} ({item.products.sku})
                  <input
                    value={manual[item.id] ?? ''}
                    onChange={(e) =>
                      setManual((rows) => ({ ...rows, [item.id]: e.target.value }))
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </label>
              ))}
              <p className="muted" style={{ margin: 0 }}>
                Суммалардын жыйынтыгы чыгымга тыйынга чейин тең болушу керек (§9.9).
              </p>
            </>
          )}

          <label className="checkbox">
            <input
              type="checkbox"
              checked={isPaid}
              style={{ width: 'auto' }}
              onChange={(e) => setIsPaid(e.target.checked)}
            />
            Бул чыгым төлөнгөн (§7)
          </label>

          <button type="submit" disabled={busy}>
            {busy ? 'Кошулууда…' : 'Кошуу'}
          </button>
        </form>
      )}
    </>
  );
}

/** Step 3 — the rates the goods are valued at (§10.1). */
function RatesStep({
  receipt,
  locked,
  onSaved,
}: {
  receipt: Receipt;
  locked: boolean;
  onSaved: () => void;
}) {
  const { hasRole } = useAuth();
  const suggestion = useApi<{ cny: RateSuggestion; usd: RateSuggestion | null }>(
    `/receipts/${receipt.document_id}/rate-suggestion`,
  );
  const [rateCny, setRateCny] = useState('');
  const [rateUsd, setRateUsd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(useSuggestion: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/receipts/${receipt.document_id}/rates`, {
        method: 'POST',
        body: useSuggestion
          ? {}
          : {
              ...(rateCny.trim() ? { rate_cny: rateCny.trim() } : {}),
              ...(rateUsd.trim() ? { rate_usd: rateUsd.trim() } : {}),
            },
      });
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const cny = suggestion.data?.cny;

  return (
    <div className="card">
      <h3 className="section-title">Курстар (§10.1)</h3>
      <ErrorBanner message={error ?? suggestion.error} />

      {receipt.rate_cny && (
        <div className="row">
          <span className="muted">Учурда коюлган CNY курсу</span>
          <span>
            {receipt.rate_cny}{' '}
            <span className="badge neutral">{receipt.rate_cny_source}</span>
          </span>
        </div>
      )}

      {cny && (
        <div className="banner info">
          <div>
            Система сунуштайт: <strong>{cny.rate}</strong> ({cny.source})
          </div>
          <div className="muted">
            Төлөнгөн {cny.paid_amount} CNY × {cny.paid_rate ?? '—'} (фактілик) +
            карыз {cny.unpaid_amount} CNY × {cny.unpaid_rate} (reference)
          </div>
        </div>
      )}

      {!locked && hasRole('OWNER') && (
        <>
          <button disabled={busy} onClick={() => save(true)}>
            Сунушталган курсту колдонуу
          </button>

          <label>
            Же CNY курсун кол менен (MANUAL болуп жазылат)
            <input
              value={rateCny}
              onChange={(e) => setRateCny(e.target.value)}
              inputMode="decimal"
              placeholder={cny?.rate ?? '13.000000'}
            />
          </label>
          <label>
            USD курсу (карго чыгымдары үчүн)
            <input
              value={rateUsd}
              onChange={(e) => setRateUsd(e.target.value)}
              inputMode="decimal"
              placeholder={receipt.rate_usd ?? '87.000000'}
            />
          </label>
          <button className="secondary" disabled={busy} onClick={() => save(false)}>
            Кол менен коюу
          </button>
        </>
      )}

      {!hasRole('OWNER') && (
        <p className="muted" style={{ margin: 0 }}>
          Курсту OWNER коёт.
        </p>
      )}
    </div>
  );
}

/** Step 4 — the unit costs this will fix, and the tiyin-level check (§2.8). */
function PreviewStep({
  receiptId,
  problems,
}: {
  receiptId: string;
  problems: ReceiptProblem[];
}) {
  const preview = useApi<CostingPreview>(
    problems.length === 0 ? `/receipts/${receiptId}/preview` : null,
  );

  if (problems.length > 0) {
    return (
      <div className="card">
        <h3 className="section-title">Толтурулушу керек</h3>
        <ProblemList problems={problems} />
      </div>
    );
  }

  if (preview.loading) return <Loading />;
  if (preview.error || !preview.data) {
    return <ErrorBanner message={preview.error ?? 'Эсептелген жок'} />;
  }

  return (
    <div className="card">
      <h3 className="section-title">Эсептелген өздүк нарк (§9.7)</h3>
      <div className="lines">
        {preview.data.lines.map((line) => (
          <div className="line" key={line.line_id} style={{ display: 'block' }}>
            <div className="row">
              <strong>{line.name}</strong>
              <Money value={line.unit_landed_cost} currency="KGS" className="big" />
            </div>
            <div className="muted">
              {line.sku} · келди {line.received_qty}
              {line.damaged_qty !== '0.00' && ` (брак ${line.damaged_qty})`} ·
              салмагы {line.total_weight_kg} кг
            </div>
            <div className="muted">
              Товар <Money value={line.purchase_cost_kgs} /> + чыгым{' '}
              <Money value={line.allocated_total_kgs} /> ={' '}
              <Money value={line.total_landed_cost_kgs} currency="KGS" />
            </div>
            {line.received_qty === '0.00' && (
              <div className="muted">
                Келген жок — layer түзүлбөйт, чыгым да жүктөлбөйт (§8.6).
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="row">
        <strong>Партиянын жалпы наркы</strong>
        <Money value={preview.data.total_landed_cost_kgs} currency="KGS" className="big" />
      </div>
      <div className="row">
        <span className="muted">Жалпы салмак</span>
        <span>{preview.data.total_weight_kg} кг</span>
      </div>
      <p className="banner ok">
        Σ чыгым = Σ бөлүштүрүлгөн, тыйынга чейин (§9.9). Тастыктагандан кийин
        бул нарк өзгөрбөйт.
      </p>
    </div>
  );
}

/** Step 5 — READY, then confirm (§7). */
function ConfirmStep({
  receipt,
  problems,
  locked,
  onConfirmed,
}: {
  receipt: Receipt;
  problems: ReceiptProblem[];
  locked: boolean;
  onConfirmed: () => void;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(path: string) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST' });
      onConfirmed();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    return (
      <div className="card">
        <p className="banner ok">Приход тастыкталды — товар складга кирди.</p>
        <button onClick={() => navigate('/stock')}>Складды көрүү</button>
        <button
          className="secondary"
          onClick={() => navigate(`/discrepancies?receipt_id=${receipt.document_id}`)}
        >
          Расхождениелер
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="section-title">Тастыктоо</h3>
      <ErrorBanner message={error} />

      {problems.length > 0 ? (
        <>
          <p className="banner warn">
            Приход тастыкталбайт — төмөнкүлөр толтурулушу керек (§7, §9.8):
          </p>
          <ProblemList problems={problems} />
        </>
      ) : (
        <>
          <p className="banner ok">Бардык маалымат толук.</p>
          {receipt.rstatus === 'DRAFT' && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => run(`/receipts/${receipt.document_id}/ready`)}
            >
              Кабыл алууга даяр деп белгилөө
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => run(`/documents/${receipt.document_id}/confirm`)}
          >
            {busy ? 'Тастыкталууда…' : 'Приход кылуу (кайтарылгыс)'}
          </button>
          <p className="muted" style={{ margin: 0 }}>
            Тастыктагандан кийин товар складга кирет, өздүк нарк бекитилет
            жана өзгөрбөйт (§18.1.6.3–4).
          </p>
        </>
      )}
    </div>
  );
}

function ProblemList({ problems }: { problems: ReceiptProblem[] }) {
  return (
    <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
      {problems.map((problem, index) => (
        <li key={`${problem.code}-${index}`}>
          {problem.message}
          {problem.field && (
            <span className="muted"> · талаа: {problem.field}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
