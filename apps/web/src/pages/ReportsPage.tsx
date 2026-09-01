import { useState } from 'react';
import type {
  BalanceReport,
  CashFlowReport,
  ProfitAndLossReport,
} from '../api/types';
import { Money } from '../components/Money';
import { ErrorBanner, Loading, Page } from '../components/Page';
import { useApi } from '../hooks/useApi';

/**
 * The three financial statements (§28).
 *
 * One screen with three tabs, because they answer three halves of the same
 * question and the OWNER reads them together: what the month earned, where
 * the money went, and what the business is standing on.
 */
type Tab = 'profit' | 'cash' | 'balance';

const TABS: { id: Tab; label: string }[] = [
  { id: 'profit', label: 'ОПУ' },
  { id: 'cash', label: 'ДДС' },
  { id: 'balance', label: 'Баланс' },
];

function monthStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('profit');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  return (
    <Page title="Отчеттор (§28)">
      <div className="card">
        <div className="inline">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={tab === entry.id ? '' : 'secondary'}
              style={{ flex: 1 }}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {tab !== 'balance' && (
          <div className="inline">
            <label style={{ flex: 1 }}>
              Башталышы
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label style={{ flex: 1 }}>
              Аягы
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}
      </div>

      {tab === 'profit' && <ProfitAndLoss from={from} to={to} />}
      {tab === 'cash' && <CashFlow from={from} to={to} />}
      {tab === 'balance' && <Balance />}
    </Page>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="row">
      <span className={muted ? 'muted' : undefined}>{label}</span>
      {strong ? (
        <strong>
          <Money value={value} currency="KGS" />
        </strong>
      ) : (
        <span className={muted ? 'muted' : undefined}>{value}</span>
      )}
    </div>
  );
}

function ProfitAndLoss({ from, to }: { from: string; to: string }) {
  const report = useApi<ProfitAndLossReport>(
    `/reports/profit-loss?from=${from}&to=${to}`,
  );
  const data = report.data;

  return (
    <>
      {report.loading && <Loading />}
      <ErrorBanner message={report.error} />
      {data && (
        <>
          <div className="card">
            <h3 className="section-title">Сатуудан маржа (§13.3)</h3>
            <Row label={`Сатуу (${data.sales_count})`} value={data.revenue} />
            <Row label="Возврат (§35)" value={`−${data.returns}`} muted />
            <Row label="Таза сатуу" value={data.net_revenue} strong />
            <Row label="FIFO өздүк нарк" value={`−${data.cogs}`} muted />
            <Row label="Кайтканынын нарки" value={`+${data.returned_cost}`} muted />
            <Row label="Маржа" value={data.gross_margin} strong />
          </div>

          <div className="card">
            <h3 className="section-title">Операциялык чыгымдар</h3>
            {data.expense_lines.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                Бул мезгилде чыгым жок.
              </p>
            )}
            {data.expense_lines.map((line) => (
              <Row key={line.category} label={line.category} value={line.amount} muted />
            ))}
            <Row label="Баары" value={data.operating_expenses} strong />
          </div>

          <div className="card">
            <h3 className="section-title">Жыйынтык</h3>
            <Row label="Маржа" value={data.gross_margin} muted />
            <Row label="Чыгымдар" value={`−${data.operating_expenses}`} muted />
            <Row label="Башка киреше (§38.7)" value={`+${data.other_income}`} muted />
            <Row label="Списание (§38)" value={`−${data.write_offs}`} muted />
            <Row
              label="Инвентаризациянын жыйынтыгы (§22)"
              value={`−${data.inventory_result}`}
              muted
            />
            <Row label="Операциялык пайда" value={data.operating_profit} strong />
            <Row label="Курстук айырма (§42.8)" value={data.fx_gain_loss} muted />
            <Row label="Таза пайда" value={data.net_profit} strong />
          </div>

          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              Ээсинин акча алуусу бул мезгилде{' '}
              <strong>{data.owner_withdrawals_excluded}</strong> сом — ал чыгым
              эмес жана пайданы азайтпайт (§3.1.1, §3.1.6). Ал ДДСте капиталдык
              агым катары, Баланста капиталдын азайышы катары көрүнөт.
            </p>
          </div>
        </>
      )}
    </>
  );
}

const SECTION_LABEL: Record<string, string> = {
  OPERATING: 'Операциялык агым',
  INVESTING: 'Инвестициялык агым',
  CAPITAL_FINANCING: 'Капиталдык / финансылык агым',
  INTERNAL_TRANSFER: 'Ички которуулар (жалпы акчаны өзгөртпөйт)',
};

function CashFlow({ from, to }: { from: string; to: string }) {
  const report = useApi<CashFlowReport>(`/reports/cash-flow?from=${from}&to=${to}`);
  const data = report.data;

  return (
    <>
      {report.loading && <Loading />}
      <ErrorBanner message={report.error} />
      {data && (
        <>
          <div className="card">
            <Row label="Мезгил башындагы акча" value={data.opening_cash_kgs} />
            <Row label="Өзгөрүү" value={data.net_change_kgs} muted />
            <Row label="Мезгил аягындагы акча" value={data.closing_cash_kgs} strong />
          </div>

          {data.sections.map((section) => (
            <div className="card" key={section.category}>
              <h3 className="section-title">{SECTION_LABEL[section.category]}</h3>
              {section.lines.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  Бул мезгилде мындай агым жок.
                </p>
              ) : (
                section.lines.map((line) => (
                  <div
                    className="row"
                    key={`${line.doc_type}-${line.currency}-${line.direction}`}
                  >
                    <span>
                      {line.doc_type}
                      <span className="muted">
                        {' '}
                        · {line.documents} документ
                        {line.currency !== 'KGS' ? ` · ${line.amount} ${line.currency}` : ''}
                      </span>
                    </span>
                    <Money value={line.kgs} currency="KGS" />
                  </div>
                ))
              )}
              <Row label="Кирди" value={section.in_kgs} muted />
              <Row label="Чыкты" value={section.out_kgs} muted />
              <Row label="Таза" value={section.net_kgs} strong />
            </div>
          ))}

          {data.unvalued.length > 0 && (
            <div className="card">
              <p className="banner warn" style={{ margin: 0 }}>
                Сом баасы жазылбаган валюталык кыймылдар сом суммасына кошулган
                жок: {data.unvalued.map((row) => row.doc_number).join(', ')}
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Balance() {
  const report = useApi<BalanceReport>('/reports/balance');
  const data = report.data;

  return (
    <>
      {report.loading && <Loading />}
      <ErrorBanner message={report.error} />
      {data && (
        <>
          <div className="card">
            <h3 className="section-title">Актив</h3>
            {data.cash.map((account) => (
              <div className="row" key={account.account_id}>
                <span>
                  {account.name}
                  {account.currency !== 'KGS' && (
                    <span className="muted">
                      {' '}
                      · {account.amount} {account.currency}
                    </span>
                  )}
                </span>
                <Money value={account.kgs} currency="KGS" />
              </div>
            ))}
            <Row label="Кассалар жана банктар" value={data.cash_total_kgs} strong />
            <Row label="Склад — сатылуучу" value={data.inventory_main} muted />
            <Row label="Склад — брак" value={data.inventory_defect} muted />
            <Row label="Склад, баары" value={data.inventory_total} strong />
            <Row label="Кардар карызы" value={data.customer_receivables} muted />
            <Row
              label="Поставщиктен алына турган"
              value={data.supplier_receivable_total_kgs}
              muted
            />
            <Row
              label="Каргодон алына турган"
              value={data.cargo_receivable_total_kgs}
              muted
            />
            <Row label="Ачык талаптар (§8.5)" value={data.open_claims_total} muted />
            <Row label="Актив, баары" value={data.assets} strong />
          </div>

          <div className="card">
            <h3 className="section-title">Пассив</h3>
            {data.supplier_payable.map((row) => (
              <div className="row" key={row.name}>
                <span>
                  {row.name}
                  <span className="muted"> · {row.balance_cny} CNY</span>
                </span>
                <Money value={row.kgs} currency="KGS" />
              </div>
            ))}
            <Row
              label="Поставщик карызы (CNY)"
              value={data.supplier_payable_total_kgs}
              muted
            />
            {data.cargo_payable.map((row) => (
              <div className="row" key={row.name}>
                <span>
                  {row.name}
                  <span className="muted"> · {row.balance_usd} USD</span>
                </span>
                <Money value={row.kgs} currency="KGS" />
              </div>
            ))}
            <Row label="Карго карызы (USD)" value={data.cargo_payable_total_kgs} muted />
            <Row label="Кардарлардын авансы (§17-А.5)" value={data.customer_advances} muted />
            <Row label="Пассив, баары" value={data.liabilities} strong />
            <p className="muted" style={{ margin: 0 }}>
              Кардарлардын авансы кардар карызы менен эч качан бир статьяга
              кошулбайт — экөө карама-каршы багытта (§17-А.5).
            </p>
          </div>

          <div className="card">
            <h3 className="section-title">Капитал</h3>
            <Row label="Салынган капитал" value={data.capital_contributed} muted />
            <Row label="Алынган капитал" value={`−${data.capital_withdrawn}`} muted />
            <Row label="Бөлүштүрүлбөгөн пайда" value={data.retained_earnings} muted />
            <Row label="Капитал, баары" value={data.equity} strong />
          </div>

          <div className="card">
            <p
              className={`banner ${data.balanced ? 'ok' : 'warn'}`}
              style={{ margin: 0 }}
            >
              {data.balanced
                ? `Актив = Пассив + Капитал. Баланс чогулду (${data.as_of}).`
                : `Айырма ${data.difference} сом. Бул — документсиз кыймыл болгонун билдирет (§27, §42.3).`}
            </p>
          </div>
        </>
      )}
    </>
  );
}
