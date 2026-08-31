import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Category, Product } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * The catalogue (§12-Б).
 *
 * Search is the point of the screen: §12-Б.9.6 has it read SKU, name,
 * barcode, OEM code and the alternative names, because the person at the
 * counter types whatever the customer called the part.
 */
export function ProductsPage() {
  const { hasRole } = useAuth();
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  const categories = useApi<Category[]>('/categories');
  const products = useApi<Product[]>(
    `/products?${new URLSearchParams({
      ...(query.trim() ? { q: query.trim() } : {}),
      ...(includeInactive ? { include_inactive: 'true' } : {}),
    }).toString()}`,
  );

  const shown = (products.data ?? []).filter(
    (product) => !categoryId || product.category_id === categoryId,
  );

  return (
    <Page
      title="Товарлар"
      actions={
        hasRole('OWNER') ? (
          <Link to="/products/new" className="badge ok">
            + Жаңы
          </Link>
        ) : undefined
      }
    >
      <div className="card">
        <label>
          Издөө
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SKU, аталыш, barcode, OEM же башка ат"
          />
        </label>
        <label>
          Категория
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Баары</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Пассивдерин да көрсөт
        </label>
        <Link to="/categories" className="muted">
          Категорияларды башкаруу →
        </Link>
      </div>

      <ErrorBanner message={products.error} />
      {products.loading && <Loading />}
      {!products.loading && shown.length === 0 && <Empty text="Товар табылган жок." />}

      {shown.map((product) => (
        <Link
          key={product.id}
          to={`/products/${product.id}`}
          className="card card-link"
        >
          <div className="row">
            <strong>{product.name}</strong>
            {product.min_selling_price && (
              <Money value={product.min_selling_price} currency="KGS" />
            )}
          </div>
          <div className="row">
            <span className="muted">{product.sku}</span>
            <span className="muted">{product.brand ?? ''}</span>
          </div>
          <div className="inline">
            {!product.is_active && <span className="badge danger">Пассив</span>}
            {!product.weight_kg && (
              <span className="badge warn" title="§9.1: салмагы жок товар менен приход тастыкталбайт">
                Салмагы жок
              </span>
            )}
            <span className="badge neutral">{product.unit}</span>
          </div>
        </Link>
      ))}
    </Page>
  );
}
