import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import type { Category } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * Product categories (§12-Б.1).
 *
 * The one field that carries a rule is the warranty term: a product without
 * its own inherits this one, and §36-А.2 judges warranty returns by it. The
 * screen says so, because "30" on its own looks like a label rather than the
 * number a refused return will cite.
 */
export function CategoriesPage() {
  const { hasRole } = useAuth();
  const isOwner = hasRole('OWNER');
  const categories = useApi<Category[]>('/categories');

  const [name, setName] = useState('');
  const [days, setDays] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/categories', {
        method: 'POST',
        body: { name: name.trim(), default_warranty_days: Number(days || '0') },
      });
      setName('');
      setDays('0');
      categories.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(category: Category, warrantyDays: number) {
    setError(null);
    try {
      await api(`/categories/${category.id}`, {
        method: 'PATCH',
        body: { default_warranty_days: warrantyDays },
      });
      categories.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function remove(category: Category) {
    setError(null);
    try {
      await api(`/categories/${category.id}`, { method: 'DELETE' });
      categories.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <Page title="Товар категориялары" back="/products">
      <ErrorBanner message={error ?? categories.error} />

      {isOwner && (
        <form className="card" onSubmit={create}>
          <h3 className="section-title">Жаңы категория</h3>
          <label>
            Аталышы
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Моторлор"
              required
            />
          </label>
          <label>
            Демейки кепилдик (күн)
            <input
              value={days}
              inputMode="numeric"
              onChange={(e) => setDays(e.target.value)}
            />
          </label>
          <p className="muted" style={{ margin: 0 }}>
            Товардын өз мөөнөтү жок болсо ушул колдонулат (§12-Б.7). 0 — кепилдик
            жок дегени, бул да толук жооп (§36-А.1).
          </p>
          <button type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Түзүлүүдө…' : 'Түзүү'}
          </button>
        </form>
      )}

      {categories.loading && <Loading />}
      {categories.data?.length === 0 && <Empty text="Категория жок." />}

      {(categories.data ?? []).map((category) => (
        <CategoryRow
          key={category.id}
          category={category}
          editable={isOwner}
          onSave={save}
          onRemove={remove}
        />
      ))}
    </Page>
  );
}

function CategoryRow({
  category,
  editable,
  onSave,
  onRemove,
}: {
  category: Category;
  editable: boolean;
  onSave: (category: Category, days: number) => void;
  onRemove: (category: Category) => void;
}) {
  const [days, setDays] = useState(String(category.default_warranty_days));
  const changed = Number(days || '0') !== category.default_warranty_days;

  return (
    <div className="card">
      <div className="row">
        <strong>{category.name}</strong>
        <span className="badge neutral">{category.product_count} товар</span>
      </div>

      {editable ? (
        <>
          <label>
            Демейки кепилдик (күн)
            <input
              value={days}
              inputMode="numeric"
              onChange={(e) => setDays(e.target.value)}
            />
          </label>
          <div className="inline">
            <button
              type="button"
              disabled={!changed}
              onClick={() => onSave(category, Number(days || '0'))}
            >
              Сактоо
            </button>
            <button
              type="button"
              className="danger"
              disabled={category.product_count > 0}
              title={
                category.product_count > 0
                  ? 'Товары бар категория өчүрүлбөйт (§12-Б.7)'
                  : undefined
              }
              onClick={() => onRemove(category)}
            >
              Өчүрүү
            </button>
          </div>
        </>
      ) : (
        <span className="muted">
          Демейки кепилдик: {category.default_warranty_days} күн
        </span>
      )}
    </div>
  );
}
