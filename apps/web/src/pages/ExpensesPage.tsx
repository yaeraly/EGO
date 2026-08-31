import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import type {
  AccountBalance,
  Expense,
  ExpenseCategory,
  MonthlySpend,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * Operating expenses (§26).
 *
 * The screen says the one thing §26 is emphatic about: freight that belongs
 * to a batch does not come here. It is part of what those goods cost, and §9
 * allocates it into the landed cost.
 */
export function ExpensesPage() {
  const { hasRole } = useAuth();
  const categories = useApi<ExpenseCategory[]>('/expense-categories');
  const accounts = useApi<AccountBalance[]>('/accounts/balances');
  const expenses = useApi<Expense[]>('/expenses');
  const monthly = useApi<MonthlySpend[]>('/expenses/monthly');

  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = !categories.loading && !accounts.loading;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/expenses', {
        method: 'POST',
        body: {
          category_id: categoryId,
          account_id: accountId,
          amount: amount.trim(),
          comment: comment.trim(),
        },
      });
      await api(`/documents/${document.id}/confirm`, { method: 'POST' });
      setAmount('');
      setComment('');
      expenses.reload();
      monthly.reload();
      accounts.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Операциялык чыгымдар">
      {!ready ? (
        <Loading />
      ) : (
        <form className="card" onSubmit={submit}>
          <ErrorBanner message={error} />

          <label>
            Категория
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
            >
              <option value="">—</option>
              {(categories.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Кайсы эсептен төлөндү
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
            >
              <option value="">—</option>
              {(accounts.data ?? [])
                .filter((account) => account.is_active)
                .map((account) => (
                  <option key={account.account_id} value={account.account_id}>
                    {account.name} · {account.balance} {account.currency}
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
            Комментарий
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Эмне үчүн төлөндү"
              required
            />
          </label>

          <button
            type="submit"
            disabled={busy || !categoryId || !accountId || !amount.trim()}
          >
            {busy ? 'Катталууда…' : 'Чыгымды каттоо'}
          </button>
          <p className="muted" style={{ margin: 0 }}>
            Партияга тиешелүү логистика бул жерге кирбейт — ал өздүк наркка
            allocation аркылуу кошулат (§9, §26). Партияга байланышпаган майда
            транспорт гана бул жерде.
          </p>
        </form>
      )}

      {/*
        The OWNER's category form stands on its own: with no categories yet
        there is no monthly report to hang it under, and no way to make the
        first one.
      */}
      {hasRole('OWNER') && (
        <Categories
          onChange={() => {
            categories.reload();
            monthly.reload();
          }}
        />
      )}

      {(monthly.data ?? []).length > 0 && (
        <div className="card">
          <h3 className="section-title">Бул айдагы чыгым (§26)</h3>
          {(monthly.data ?? []).map((row) => (
            <div key={row.category_id}>
              <div className="row">
                <span>{row.name}</span>
                <Money value={row.spent} currency="KGS" />
              </div>
              {row.monthly_budget && (
                <div className="row">
                  <span className="muted">
                    Бюджет {row.monthly_budget} · калды {row.remaining}
                  </span>
                  {row.over_budget && (
                    <span className="badge danger">Бюджеттен ашты</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ErrorBanner message={expenses.error} />
      {expenses.data?.length === 0 && <Empty text="Чыгым жок." />}

      {(expenses.data ?? []).map((expense) => (
        <div className="card" key={expense.document_id}>
          <div className="row">
            <strong>{expense.expense_categories.name}</strong>
            <Money
              value={expense.amount}
              currency={expense.payment_accounts.currency}
            />
          </div>
          <div className="row">
            <span className="muted">{expense.documents.doc_number}</span>
            <span className="muted">
              {expense.documents.business_date.slice(0, 10)}
            </span>
          </div>
          <div className="row">
            <span className="muted">{expense.documents.comment}</span>
            <span className="muted">{expense.payment_accounts.name}</span>
          </div>
        </div>
      ))}
    </Page>
  );
}

/** §26 — the OWNER names the categories and sets the ceilings. */
function Categories({ onChange }: { onChange: () => void }) {
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('/expense-categories', {
        method: 'POST',
        body: {
          name: name.trim(),
          ...(budget.trim() ? { monthly_budget: budget.trim() } : {}),
        },
      });
      setName('');
      setBudget('');
      onChange();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <form className="card" onSubmit={add}>
      <h3 className="section-title">Жаңы чыгым категориясы (§26)</h3>
      <ErrorBanner message={error} />
      <div className="inline">
        <label style={{ flex: 2 }}>
          Аталышы
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Аренда"
          />
        </label>
        <label style={{ flex: 1 }}>
          Айлык бюджет
          <input
            value={budget}
            inputMode="decimal"
            onChange={(e) => setBudget(e.target.value)}
          />
        </label>
      </div>
      <button type="submit" disabled={!name.trim()}>
        Кошуу
      </button>
    </form>
  );
}
