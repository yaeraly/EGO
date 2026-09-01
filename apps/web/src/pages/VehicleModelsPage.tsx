import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { Product, VehicleModel } from '../api/types';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * Tricycle models, and the parts that fit them (§12-Б.8).
 *
 * The list is the OWNER's; picking a model shows what fits it, and the
 * checked-only switch is what makes the filter safe to quote at the counter.
 */
export function VehicleModelsPage() {
  const { hasRole } = useAuth();
  const models = useApi<VehicleModel[]>('/vehicle-models');

  const [selected, setSelected] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [brand, setBrand] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parts = useApi<Product[]>(
    selected
      ? `/products?model_id=${selected}${verifiedOnly ? '&verified_only=true' : ''}`
      : null,
  );

  async function addModel(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/vehicle-models', {
        method: 'POST',
        body: {
          name: name.trim(),
          ...(brand.trim() ? { brand: brand.trim() } : {}),
        },
      });
      setBrand('');
      setName('');
      models.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Трицикл моделдери (§12-Б.8)">
      {hasRole('OWNER') && (
        <form className="card" onSubmit={addModel}>
          <h3 className="section-title">Модель кошуу</h3>
          <ErrorBanner message={error} />
          <div className="inline">
            <label style={{ flex: 1 }}>
              Бренд
              <input
                value={brand}
                placeholder="милдеттүү эмес"
                onChange={(e) => setBrand(e.target.value)}
              />
            </label>
            <label style={{ flex: 2 }}>
              Модель
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
          </div>
          <button type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Сакталууда…' : 'Кошуу'}
          </button>
        </form>
      )}

      <div className="card">
        <h3 className="section-title">Модель боюнча тетик издөө</h3>
        {models.loading && <Loading />}
        <ErrorBanner message={models.error} />
        <label>
          Модель
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">—</option>
            {(models.data ?? []).map((model) => (
              <option key={model.id} value={model.id}>
                {[model.brand, model.name].filter(Boolean).join(' ')} ·{' '}
                {model.products} тетик
              </option>
            ))}
          </select>
        </label>
        <label className="inline" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
          />
          <span>Текшерилгендери гана</span>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          Текшерилген байланыш — ээси өзү ырастаган. Текшерилбегени «айтылган»
          дегенди билдирет: кардарга ошондой айтуу керек.
        </p>
      </div>

      {selected && (
        <>
          {parts.loading && <Loading />}
          <ErrorBanner message={parts.error} />
          {parts.data?.length === 0 && (
            <Empty text="Бул моделге тетик байланышкан эмес." />
          )}
          {(parts.data ?? []).map((product) => (
            <Link
              className="card card-link"
              key={product.id}
              to={`/products/${product.id}`}
            >
              <div className="row">
                <strong>{product.name}</strong>
                <span className="muted">{product.sku}</span>
              </div>
            </Link>
          ))}
        </>
      )}

      {!selected && models.data?.length === 0 && (
        <Empty text="Азырынча модель киргизилген эмес." />
      )}

      {!selected &&
        (models.data ?? []).map((model) => (
          <div className="card" key={model.id}>
            <div className="row">
              <strong>{[model.brand, model.name].filter(Boolean).join(' ')}</strong>
              <span className="muted">
                {model.products} тетик · {model.verified} текшерилген
              </span>
            </div>
          </div>
        ))}
    </Page>
  );
}
