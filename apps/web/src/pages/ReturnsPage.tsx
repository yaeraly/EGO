import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type {
  AccountBalance,
  ReturnCondition,
  ReturnDoc,
  SaleDetail,
  SaleListItem,
} from '../api/types';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/** Returns (RET) — §35. Every one of them names the sale it reverses. */
export function ReturnsPage() {
  const returns = useApi<ReturnDoc[]>('/returns');
  const sales = useApi<SaleListItem[]>('/sales?mine=true');

  return (
    <Page title="Возвраттар">
      <div className="card">
        <h3 className="section-title">Кайсы сатуудан</h3>
        <p className="muted" style={{ margin: 0 }}>
          Возврат ар дайым баштапкы сатууга байланышат — Walk-in үчүн да (§35.1).
        </p>
        {(sales.data ?? [])
          .filter(
            (sale) =>
              sale.documents_sales_document_idTodocuments.status === 'CONFIRMED',
          )
          .slice(0, 10)
          .map((sale) => (
            <Link
              key={sale.document_id}
              to={`/returns/new?sale=${sale.document_id}`}
              className="row"
            >
              <span>{sale.documents_sales_document_idTodocuments.doc_number}</span>
              <Money value={sale.total_amount} currency="KGS" />
            </Link>
          ))}
      </div>

      <ErrorBanner message={returns.error} />
      {returns.loading && <Loading />}
      {returns.data?.length === 0 && <Empty text="Возврат жок." />}

      {(returns.data ?? []).map((record) => (
        <div className="card" key={record.document.id}>
          <div className="row">
            <strong>{record.document.doc_number}</strong>
            <Money value={record.total_return_amount} currency="KGS" />
          </div>
          <div className="row">
            <span className="muted">{record.customer.name}</span>
            <span className="muted">{record.original_sale.doc_number}</span>
          </div>
          <div className="inline">
            <span
              className={`badge ${
                record.document.status === 'CONFIRMED' ? 'ok' : 'neutral'
              }`}
            >
              {record.document.status === 'CONFIRMED' ? 'Тастыкталды' : 'Черновик'}
            </span>
            {record.debt_offset !== '0.00' && (
              <span className="badge warn">Карызга {record.debt_offset}</span>
            )}
            {record.cash_refund !== '0.00' && (
              <span className="badge neutral">Колго {record.cash_refund}</span>
            )}
          </div>
        </div>
      ))}
    </Page>
  );
}

interface DraftLine {
  qty: string;
  condition: ReturnCondition;
}

/** Making a return: pick the lines, say why, then settle (§35.2). */
export function ReturnFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const saleId = params.get('sale') ?? '';

  const sale = useApi<SaleDetail>(saleId ? `/sales/${saleId}` : null);
  const accounts = useApi<AccountBalance[]>('/accounts/balances');

  const [lines, setLines] = useState<Record<string, DraftLine>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ReturnDoc | null>(null);
  const [settlement, setSettlement] = useState<{
    debt_offset: string;
    cash_refund: string;
  } | null>(null);
  const [accountId, setAccountId] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [warrantyReason, setWarrantyReason] = useState('');

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const items = Object.entries(lines)
        .filter(([, line]) => line.qty.trim() && Number(line.qty) > 0)
        .map(([saleItemId, line]) => ({
          sale_item_id: saleItemId,
          qty: line.qty.trim(),
          condition: line.condition,
        }));

      const document = await api<{ id: string }>('/returns', {
        method: 'POST',
        body: { original_sale: saleId, reason: reason.trim(), items },
      });
      setPending(await api<ReturnDoc>(`/returns/${document.id}`));
      // §35.4 decides the split, so the screen asks the server rather than
      // working it out again and disagreeing.
      setSettlement(
        await api<{ debt_offset: string; cash_refund: string }>(
          `/returns/${document.id}/settlement`,
        ),
      );
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(pin: string) {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const settled = await api<ReturnDoc>(
        `/returns/${pending.document.id}/confirm`,
        {
          method: 'POST',
          body: {
            pin,
            refunds:
              accountId && settlement && settlement.cash_refund !== '0.00'
                ? [{ account_id: accountId, amount: settlement.cash_refund }]
                : [],
            ...(overrideReason.trim()
              ? { source_override_reason: overrideReason.trim() }
              : {}),
            ...(warrantyReason.trim()
              ? { warranty_exception_reason: warrantyReason.trim() }
              : {}),
          },
        },
      );
      setPending(settled);
      navigate('/returns');
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!saleId) {
    return (
      <Page title="Возврат" back="/returns">
        <ErrorBanner message="Баштапкы сатуу көрсөтүлгөн жок (§35.1)" />
      </Page>
    );
  }
  if (sale.loading) {
    return <Page title="Возврат" back="/returns"><Loading /></Page>;
  }
  if (!sale.data) {
    return (
      <Page title="Возврат" back="/returns">
        <ErrorBanner message={sale.error ?? 'Сатуу табылган жок'} />
      </Page>
    );
  }

  const tills = (accounts.data ?? []).filter(
    (account) => account.currency === 'KGS' && account.is_active,
  );
  const expired = pending?.items.some((item) => item.warranty_ok === false);

  return (
    <Page title="Возврат (RET)" back="/returns">
      <ErrorBanner message={error} />

      {!pending ? (
        <form className="card" onSubmit={createDraft}>
          <div className="row">
            <strong>{sale.data.customers.name}</strong>
            <Money value={sale.data.total_amount} currency="KGS" />
          </div>

          {sale.data.sale_items.map((item) => {
            const left = Number(item.qty) - Number(item.returned_qty);
            return (
              <div key={item.id}>
                <div className="row">
                  <span>
                    {item.products.name}
                    <span className="muted"> · {item.products.sku}</span>
                  </span>
                  <span className="muted">калды {left.toFixed(2)}</span>
                </div>
                <div className="inline">
                  <label style={{ flex: 1 }}>
                    Кайтарылат
                    <input
                      value={lines[item.id]?.qty ?? ''}
                      inputMode="decimal"
                      placeholder="0"
                      disabled={left <= 0}
                      onChange={(e) =>
                        setLines((rows) => ({
                          ...rows,
                          [item.id]: {
                            qty: e.target.value,
                            condition: rows[item.id]?.condition ?? 'RESALABLE',
                          },
                        }))
                      }
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    Абалы
                    <select
                      value={lines[item.id]?.condition ?? 'RESALABLE'}
                      onChange={(e) =>
                        setLines((rows) => ({
                          ...rows,
                          [item.id]: {
                            qty: rows[item.id]?.qty ?? '',
                            condition: e.target.value as ReturnCondition,
                          },
                        }))
                      }
                    >
                      <option value="RESALABLE">Жарактуу → MAIN</option>
                      <option value="DEFECT">Брак → DEFECT</option>
                    </select>
                  </label>
                </div>
              </div>
            );
          })}

          <label>
            Кайтаруунун себеби
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </label>

          <button type="submit" disabled={busy || !reason.trim()}>
            {busy ? 'Түзүлүүдө…' : 'Возвратты эсептөө'}
          </button>
          <p className="muted" style={{ margin: 0 }}>
            Товар баштапкы сатуудагы өздүк нарк менен, бүгүнкү дата менен жаңы
            LOT катары кирет (§18.0).
          </p>
        </form>
      ) : (
        <div className="card">
          <div className="row">
            <strong>{pending.document.doc_number}</strong>
            <Money value={pending.total_return_amount} currency="KGS" />
          </div>

          {pending.items.map((item) => (
            <div className="row" key={item.id}>
              <span>
                {item.name} · {item.qty}
              </span>
              <span className="inline">
                <span className="badge neutral">
                  {item.condition === 'DEFECT' ? 'Брак' : 'Жарактуу'}
                </span>
                {item.warranty_ok === false && (
                  <span className="badge danger">Кепилдик мөөнөтү өттү</span>
                )}
              </span>
            </div>
          ))}

          {settlement && (
            <>
              <div className="row">
                <span>Карызга эсептелет</span>
                <Money value={settlement.debt_offset} currency="KGS" />
              </div>
              <div className="row">
                <span>Колго кайтарылат</span>
                <Money value={settlement.cash_refund} currency="KGS" />
              </div>
            </>
          )}
          <p className="muted" style={{ margin: 0 }}>
            Сумма адегенде кардардын ачык карызын жабат; калганы гана колго
            кайтарылат (§35.4).
          </p>

          <label>
            Кайсы эсептен кайтарылат
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={settlement?.cash_refund === '0.00'}
            >
              <option value="">— (баары карызга кетет)</option>
              {tills.map((till) => (
                <option key={till.account_id} value={till.account_id}>
                  {till.name} · {till.balance}
                </option>
              ))}
            </select>
          </label>
          <label>
            Башка эсептен болсо — себеби (§35.5)
            <input
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
            />
          </label>

          {expired && (
            <label>
              Кепилдик мөөнөтү өткөн — ЭЭСИНИН себеби (§36-А.2)
              <input
                value={warrantyReason}
                onChange={(e) => setWarrantyReason(e.target.value)}
              />
            </label>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const pin = window.prompt('PIN:');
              if (pin?.trim()) void confirm(pin.trim());
            }}
          >
            PIN менен тастыктоо
          </button>
        </div>
      )}
    </Page>
  );
}
