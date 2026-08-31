import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type {
  Advance,
  CreditStanding,
  Customer,
  CustomerPayment,
  SaleListItem,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../components/Money';
import { Empty, ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

export function CustomerListPage() {
  const [query, setQuery] = useState('');
  const customers = useApi<Customer[]>(
    `/customers${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`,
  );
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('/customers', {
        method: 'POST',
        body: { name: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) },
      });
      setName('');
      setPhone('');
      customers.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <Page title="Кардарлар">
      <div className="card">
        <label>
          Издөө (аты же телефон)
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      <form className="card" onSubmit={create}>
        <h3 className="section-title">Жаңы кардар</h3>
        <ErrorBanner message={error} />
        <label>
          Аты
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Телефон
          <input
            value={phone}
            inputMode="tel"
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <button type="submit" disabled={!name.trim()}>
          Каттоо
        </button>
        <p className="muted" style={{ margin: 0 }}>
          Карызга сатуу, бронь, аванс же категория керек болсо кардар өзүнчө
          катталат (§11.1.5).
        </p>
      </form>

      <ErrorBanner message={customers.error} />
      {customers.loading && <Loading />}
      {customers.data?.length === 0 && <Empty text="Кардар жок." />}

      {(customers.data ?? []).map((customer) => (
        <Link
          key={customer.id}
          to={`/customers/${customer.id}`}
          className="card card-link"
        >
          <div className="row">
            <strong>{customer.name}</strong>
            {customer.is_walk_in && <span className="badge neutral">Walk-in</span>}
          </div>
          <div className="inline">
            <span className="muted">{customer.phone ?? '—'}</span>
            <span className="badge neutral">{customer.ctype}</span>
            {!customer.is_walk_in && (
              <span className="badge info">{customer.category}</span>
            )}
          </div>
        </Link>
      ))}
    </Page>
  );
}

/** The customer card: debts by sale, payment history, category (§4.11). */
export function CustomerPage() {
  const { id = '' } = useParams();
  const { hasRole } = useAuth();

  const customer = useApi<Customer>(`/customers/${id}`);
  const credit = useApi<CreditStanding>(`/sales/credit/${id}`);
  const sales = useApi<SaleListItem[]>(`/sales?customer_id=${id}`);
  const payments = useApi<CustomerPayment[]>(`/customer-payments?customer_id=${id}`);
  const advances = useApi<Advance[]>(`/customer-payments/customers/${id}/advances`);

  const [limit, setLimit] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function saveLimit() {
    setError(null);
    try {
      await api(`/customers/${id}`, {
        method: 'PATCH',
        body: { individual_credit_limit: limit.trim() },
      });
      customer.reload();
      credit.reload();
      setLimit('');
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  if (customer.loading) {
    return <Page title="Кардар" back="/customers"><Loading /></Page>;
  }
  if (!customer.data) {
    return (
      <Page title="Кардар" back="/customers">
        <ErrorBanner message={customer.error ?? 'Табылган жок'} />
      </Page>
    );
  }

  const data = customer.data;

  return (
    <Page title={data.name} back="/customers">
      <div className="card">
        <div className="inline">
          <span className="badge neutral">{data.ctype}</span>
          {!data.is_walk_in && (
            <span className="badge info">
              {data.category}
              {data.category_manual_override && ' (кол менен)'}
            </span>
          )}
          {data.is_walk_in && <span className="badge neutral">Walk-in</span>}
        </div>
        <div className="row">
          <span className="muted">Телефон</span>
          <span>{data.phone ?? '—'}</span>
        </div>
        {data.is_walk_in && (
          <p className="banner info">
            Катталбаган кардар: карыз, бронь, аванс жана категория
            колдонулбайт (§11.1.2).
          </p>
        )}
      </div>

      {credit.data && !data.is_walk_in && (
        <div className="card">
          <h3 className="section-title">Кредит (§16)</h3>
          <div className="row">
            <span className="muted">Лимит ({credit.data.limit_source})</span>
            <span>{credit.data.effective_credit_limit ?? 'коюла элек'}</span>
          </div>
          <div className="row">
            <span className="muted">Учурдагы карыз</span>
            <Money value={credit.data.current_open_debt} currency="KGS" />
          </div>
          <div className="row">
            <span className="muted">Жеткиликтүү</span>
            <Money value={credit.data.available_credit} currency="KGS" />
          </div>
          {credit.data.has_overdue && (
            <p className="banner warn">
              Мөөнөтү өткөн: <Money value={credit.data.overdue_amount} /> —
              жаңы карызга сатуу блокторлот (§16.4)
            </p>
          )}

          <ErrorBanner message={error} />
          {hasRole('OWNER') && (
            <>
              <label>
                Жеке кредиттик лимит (§16.1)
                <input
                  value={limit}
                  inputMode="decimal"
                  placeholder={data.individual_credit_limit ?? '0.00'}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </label>
              <button className="secondary" disabled={!limit.trim()} onClick={saveLimit}>
                Сактоо
              </button>
            </>
          )}
        </div>
      )}

      {credit.data && credit.data.open_debts.length > 0 && (
        <div className="card">
          <h3 className="section-title">Ачык карыздар</h3>
          <div className="lines">
            {credit.data.open_debts.map((debt) => (
              <div className="line" key={debt.sale_id}>
                <div>
                  <div>{debt.doc_number}</div>
                  <div className={debt.is_overdue ? 'banner warn' : 'muted'}>
                    мөөнөтү {debt.due_date ?? '—'}
                    {debt.is_overdue && ' · өтүп кетти'}
                  </div>
                </div>
                <Money value={debt.outstanding} currency="KGS" />
              </div>
            ))}
          </div>
          <Link to={`/customer-payments/new?customer_id=${id}`}>
            <button style={{ width: '100%' }}>Төлөм кабыл алуу (PAY)</button>
          </Link>
        </div>
      )}

      {(advances.data ?? []).length > 0 && (
        <div className="card">
          <h3 className="section-title">Аванстар (§16-А.5)</h3>
          <div className="lines">
            {(advances.data ?? []).map((advance) => (
              <div className="line" key={advance.document_id}>
                <div>
                  <div>
                    {advance.documents_advances_document_idTodocuments.doc_number}
                  </div>
                  <div className="muted">{advance.astatus}</div>
                </div>
                <Money value={advance.amount} currency="KGS" />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="section-title">Сатуулар</h3>
        {(sales.data ?? []).length === 0 && <p className="muted">Сатуу жок.</p>}
        <div className="lines">
          {(sales.data ?? []).map((sale) => (
            <div className="line" key={sale.document_id}>
              <div>
                <div>{sale.documents_sales_document_idTodocuments.doc_number}</div>
                <div className="muted">
                  {sale.documents_sales_document_idTodocuments.business_date.slice(0, 10)}
                  {sale.debt_status && ` · ${sale.debt_status}`}
                </div>
              </div>
              <Money value={sale.total_amount} currency="KGS" />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">Төлөм тарыхы</h3>
        {(payments.data ?? []).length === 0 && <p className="muted">Төлөм жок.</p>}
        <div className="lines">
          {(payments.data ?? []).map((payment) => (
            <div className="line" key={payment.document_id}>
              <div>
                <div>
                  {
                    payment.documents_customer_payments_document_idTodocuments
                      .doc_number
                  }
                </div>
                <div className="muted">
                  {payment.payment_allocations.length} карызга бөлүштүрүлдү
                  {payment.overpay_advance_doc && ' · ашыкча → ADV'}
                </div>
              </div>
              <Money value={payment.total_amount} currency="KGS" />
            </div>
          ))}
        </div>
      </div>
    </Page>
  );
}
