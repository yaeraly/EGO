-- ============================================================================
-- EGOMOT Database Schema v1.0
-- Негиз: EGOMOT Business Knowledge Base v2.1 (29.08.2026)
-- Database: PostgreSQL 15+
-- Эскертүү: ар бир таблицанын жанында билим базанын тиешелүү § көрсөтүлгөн.
-- ============================================================================

-- ============================================================================
-- 0. ENUM ТИПТЕР
-- ============================================================================

CREATE TYPE user_role AS ENUM ('OWNER', 'SALES_MANAGER');                      -- §2
CREATE TYPE user_status AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');             -- Security
CREATE TYPE account_type AS ENUM ('CASH', 'BANK', 'EWALLET');                  -- §19
CREATE TYPE currency_code AS ENUM ('KGS', 'CNY', 'USD');                       -- §10-А
CREATE TYPE rate_source AS ENUM ('FACTUAL', 'REFERENCE', 'MANUAL');            -- §10.1

CREATE TYPE day_status AS ENUM ('OPEN', 'CASH_HANDED', 'DAY_CLOSED');          -- §20, Period Lock
CREATE TYPE month_status AS ENUM ('OPEN', 'MONTH_CLOSED');                     -- Period Lock

CREATE TYPE capital_source AS ENUM ('OWNER', 'INVESTOR');                      -- §3
CREATE TYPE withdrawal_type AS ENUM
  ('OWNER_WITHDRAWAL', 'INVESTOR_CAPITAL_RETURN', 'PROFIT_DISTRIBUTION');      -- §3.1

CREATE TYPE customer_type AS ENUM ('WHOLESALE', 'RETAIL', 'MASTER');           -- §11
CREATE TYPE customer_category AS ENUM ('STANDARD', 'SILVER', 'GOLD', 'VIP');   -- §12

CREATE TYPE warehouse_type AS ENUM
  ('MAIN', 'DEFECT', 'SERVICE', 'TRANSIT', 'BRANCH', 'OTHER');                 -- §12-А.3

CREATE TYPE purchase_status AS ENUM (                                          -- §6 (16 статус)
  'DRAFT', 'SENT_TO_SUPPLIER', 'SUPPLIER_ACCEPTED', 'COLLECTING',
  'LEFT_SUPPLIER', 'ARRIVED_YIWU_CARGO', 'CARGO_ACCEPTED', 'LEFT_CARGO',
  'IN_TRANSIT', 'ARRIVED_SVH', 'RELEASED_SVH', 'LOCAL_TRANSPORT',
  'ARRIVED_EGOMOT', 'READY_TO_RECEIVE', 'RECEIVED', 'CLOSED');

CREATE TYPE receipt_status AS ENUM ('DRAFT', 'READY', 'RECEIVED', 'CLOSED');   -- §7
CREATE TYPE expense_alloc_basis AS ENUM ('WEIGHT', 'VOLUME', 'VALUE', 'MANUAL'); -- §9.2
CREATE TYPE receipt_expense_type AS ENUM
  ('CHINA_TRANSPORT', 'INTL_CARGO', 'LOCAL_TRANSPORT', 'INSURANCE', 'COMMISSION', 'OTHER'); -- §5, §9

CREATE TYPE discrepancy_type AS ENUM                                            -- §8.4
  ('SUPPLIER_SHORTAGE', 'CARGO_LOSS', 'LOCAL_TRANSPORT_LOSS', 'RECEIVING_DAMAGE', 'EXCESS', 'UNKNOWN');
CREATE TYPE discrepancy_status AS ENUM                                          -- §8.9
  ('OPEN', 'UNDER_REVIEW', 'PARTIALLY_COMPENSATED', 'COMPENSATED', 'WRITTEN_OFF', 'CLOSED');
CREATE TYPE claim_type AS ENUM ('SUPPLIER_CLAIM', 'CARGO_CLAIM');               -- §8.5
CREATE TYPE claim_status AS ENUM
  ('OPEN', 'UNDER_REVIEW', 'PARTIALLY_COMPENSATED', 'COMPENSATED', 'WRITTEN_OFF', 'CLOSED');

CREATE TYPE fifo_layer_source AS ENUM ('PURCHASE', 'RETURN', 'OPENING', 'ADJUSTMENT'); -- §18, §18.0, §40.1, §22
CREATE TYPE stock_movement_type AS ENUM
  ('RECEIPT_IN', 'SALE_OUT', 'RETURN_IN', 'TRANSFER_OUT', 'TRANSFER_IN',
   'WRITEOFF_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');                          -- §12-А

CREATE TYPE transfer_status AS ENUM ('DRAFT', 'SENT', 'RECEIVED', 'CANCELLED'); -- §12-А.4

CREATE TYPE sale_status AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');            -- §14, §27.1
CREATE TYPE approval_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');       -- §13.5
CREATE TYPE compatibility_status AS ENUM ('UNVERIFIED', 'VERIFIED');           -- §12-Б.8
CREATE TYPE debt_status AS ENUM ('OPEN', 'PARTIALLY_PAID', 'CLOSED');           -- §16
CREATE TYPE reservation_status AS ENUM ('ACTIVE', 'FULFILLED', 'CANCELLED', 'EXPIRED'); -- §17
CREATE TYPE advance_status AS ENUM
  ('ACTIVE', 'PARTIALLY_APPLIED', 'APPLIED', 'REFUNDED', 'CANCELLED');          -- §17-А.6
CREATE TYPE return_condition AS ENUM ('RESALABLE', 'DEFECT');                   -- §35
CREATE TYPE bonus_status AS ENUM
  ('CALCULATED', 'PAYABLE', 'PAID', 'ADJUSTED', 'REVERSED');                    -- §23.3
CREATE TYPE doc_status AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');             -- жалпы документ статусу

-- Документ түрлөрү (27 префикс, Document Numbering Standard)
CREATE TYPE doc_type AS ENUM (
  'CAP','WDW','CEX','PUR','RCV','LOT','SAL','LSS','RET','RSV','ADV','PAY',
  'SPY','CPY','CLM','TRF','INV','DIF','DEF','WOF','EXP','SLR','BON','TRN',
  'COR','HND','OIN');

-- ============================================================================
-- 1. СИСТЕМА: колдонуучулар, настройка, номерлөө, аудит  (§2, Security, Numbering)
-- ============================================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     TEXT NOT NULL,
  phone         TEXT UNIQUE,
  role          user_role NOT NULL,
  pin_hash      TEXT NOT NULL,               -- PIN ачык текст сакталбайт (Security)
  password_hash TEXT NOT NULL,
  status        user_status NOT NULL DEFAULT 'ACTIVE',
  max_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,  -- §13.1
  bonus_rate_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,  -- §23
  base_salary      NUMERIC(14,2) NOT NULL DEFAULT 0, -- §25
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Глобалдык параметрлер (порогдор, пайыздар, лимиттер) — §44 "настройка"
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,              -- мис.: 'category.silver.threshold'
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Документ номерлөө: PREFIX-YYYY-NNNNNN, жылдык sequence, duplicate DB деңгээлинде
CREATE TABLE doc_sequences (
  doc_type    doc_type NOT NULL,
  year        INT NOT NULL,
  last_number INT NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, year)
);
-- Номер алуу: SELECT ... FOR UPDATE + last_number+1 (транзакция ичинде).

-- Бардык документтердин каттоосу (ар бир *_docs таблица буга 1:1 байланышат)
CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type     doc_type NOT NULL,
  doc_number   TEXT NOT NULL UNIQUE,         -- 'SAL-2026-000125'
  business_date DATE NOT NULL,               -- Period Lock: Business Date
  status       doc_status NOT NULL DEFAULT 'DRAFT',
  created_by   UUID NOT NULL REFERENCES users(id),
  confirmed_by UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  comment      TEXT
);
CREATE INDEX idx_documents_type_date ON documents(doc_type, business_date);

-- Audit Log — §27: ким, качан, кайсы документ, эски/жаңы маани
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  document_id UUID REFERENCES documents(id),
  entity      TEXT NOT NULL,                 -- 'sale', 'fifo_layer', ...
  entity_id   TEXT,
  action      TEXT NOT NULL,                 -- 'SALE_CONFIRMED', 'DISCOUNT_APPLIED', ...
  old_value   JSONB,
  new_value   JSONB,
  reason      TEXT,                          -- override/correction себеби
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

-- Security Log — Audit Log'дон өзүнчө (Security бөлүмү)
CREATE TABLE security_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id),
  event      TEXT NOT NULL,                  -- LOGIN_OK, LOGIN_FAIL, LOGOUT, PIN_OK, PIN_FAIL
  device     TEXT,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Мезгилдер: OPEN → CASH_HANDED → DAY_CLOSED → MONTH_CLOSED (§20, Period Lock)
CREATE TABLE business_days (
  business_date DATE PRIMARY KEY,
  status        day_status NOT NULL DEFAULT 'OPEN',
  closed_by     UUID REFERENCES users(id),
  closed_at     TIMESTAMPTZ
);

CREATE TABLE business_months (
  year      INT NOT NULL,
  month     INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  status    month_status NOT NULL DEFAULT 'OPEN',
  closed_by UUID REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  reopen_reason TEXT,                        -- Period Reopen
  PRIMARY KEY (year, month)
);

-- Ар бир сатуучунун күндүк касса өткөрүүсү (CASH_HANDED шарты, Day Close Pre-check)
CREATE TABLE daily_cash_handovers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date DATE NOT NULL REFERENCES business_days(business_date),
  user_id       UUID NOT NULL REFERENCES users(id),
  expected_amount NUMERIC(14,2) NOT NULL,
  actual_amount   NUMERIC(14,2) NOT NULL,
  difference      NUMERIC(14,2) NOT NULL,
  difference_reason TEXT,
  transfer_doc_id UUID REFERENCES documents(id),  -- TRN
  handed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_date, user_id)
);

-- ============================================================================
-- 2. АКЧА: эсептер, TRN, CEX + валюта FIFO катмарлары  (§10-А, §19)
-- ============================================================================

CREATE TABLE payment_accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,                  -- 'Азамат Cash', 'OWNER MBank', 'CNY Cash'
  type       account_type NOT NULL,
  currency   currency_code NOT NULL DEFAULT 'KGS',
  owner_user UUID REFERENCES users(id),      -- NULL = компаниялык/OWNER эсеби
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Эсептердин бардык кыймылы (баланс = SUM(amount)). Кол менен жазылбайт —
-- ар бир сап document_id аркылуу документке байланышат (§27, §42.3).
CREATE TABLE account_movements (
  id          BIGSERIAL PRIMARY KEY,
  account_id  UUID NOT NULL REFERENCES payment_accounts(id),
  document_id UUID NOT NULL REFERENCES documents(id),
  amount      NUMERIC(14,2) NOT NULL,        -- өз валютасында; кирүү +, чыгуу −
  kgs_value   NUMERIC(14,2),                 -- валюталык эсеп үчүн FIFO KGS-нарк
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_acc_mov_account ON account_movements(account_id);
-- Терс баланска тыюу (§42.5, §10-А.4) — application деңгээлинде транзакция
-- ичинде текшерилет + мезгилдик reconciliation.

-- Account Transfer (TRN) — §19
CREATE TABLE account_transfers (
  document_id  UUID PRIMARY KEY REFERENCES documents(id),
  from_account UUID NOT NULL REFERENCES payment_accounts(id),
  to_account   UUID NOT NULL REFERENCES payment_accounts(id),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0)
);

-- Currency Exchange (CEX) — §10-А.2
CREATE TABLE currency_exchanges (
  document_id     UUID PRIMARY KEY REFERENCES documents(id),
  from_account    UUID NOT NULL REFERENCES payment_accounts(id),
  to_account      UUID NOT NULL REFERENCES payment_accounts(id),
  given_amount    NUMERIC(14,2) NOT NULL CHECK (given_amount > 0),
  received_amount NUMERIC(14,2) NOT NULL CHECK (received_amount > 0),
  rate            NUMERIC(12,6) NOT NULL,    -- фактический курс
  commission      NUMERIC(14,2) NOT NULL DEFAULT 0,
  intermediary    TEXT,
  fx_gain_loss_kgs NUMERIC(14,2)             -- тескери багытта (валюта→KGS) эсептелет
);

-- Валюталык кассанын FIFO катмарлары — §10-А.3
CREATE TABLE currency_layers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES payment_accounts(id),
  cex_document_id UUID NOT NULL REFERENCES documents(id),
  original_amount NUMERIC(14,2) NOT NULL,
  remaining_amount NUMERIC(14,2) NOT NULL CHECK (remaining_amount >= 0),
  rate_kgs        NUMERIC(12,6) NOT NULL,    -- бул катмардын сатып алуу курсу
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_curr_layers_fifo ON currency_layers(account_id, created_at);

-- Катмардан чыгуу тарыхы (SPY/CPY/CEX-out кайсы катмардан канча алды)
CREATE TABLE currency_layer_consumptions (
  id          BIGSERIAL PRIMARY KEY,
  layer_id    UUID NOT NULL REFERENCES currency_layers(id),
  document_id UUID NOT NULL REFERENCES documents(id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  kgs_value   NUMERIC(14,2) NOT NULL         -- amount × layer.rate_kgs
);

-- ============================================================================
-- 3. КАПИТАЛ  (§3, §3.1)
-- ============================================================================

CREATE TABLE investors (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  phone      TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true
);

-- Капитал киргизүү (CAP) — §3
CREATE TABLE capital_docs (
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  source      capital_source NOT NULL,
  investor_id UUID REFERENCES investors(id), -- source=INVESTOR болсо милдеттүү
  account_id  UUID NOT NULL REFERENCES payment_accounts(id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency    currency_code NOT NULL DEFAULT 'KGS',
  rate        NUMERIC(12,6),
  CHECK (source != 'INVESTOR' OR investor_id IS NOT NULL)
);

-- Капитал чыгаруу (WDW) — §3.1: OPEX эмес, equity кыймылы
CREATE TABLE withdrawal_docs (
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  wtype       withdrawal_type NOT NULL,
  investor_id UUID REFERENCES investors(id),
  account_id  UUID NOT NULL REFERENCES payment_accounts(id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency    currency_code NOT NULL DEFAULT 'KGS',
  linked_capital_doc UUID REFERENCES documents(id),
  purpose     TEXT NOT NULL
);

-- ============================================================================
-- 4. MASTER DATA: товар, склад, кардар, контрагенттер  (§11, §12-А, §12-Б)
-- ============================================================================

CREATE TABLE product_categories (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  default_warranty_days INT NOT NULL DEFAULT 0      -- §36-А.1
);

CREATE TABLE products (                              -- §12-Б
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku          TEXT NOT NULL UNIQUE,                 -- §12-Б.9.1
  name         TEXT NOT NULL,
  category_id  UUID REFERENCES product_categories(id),
  brand        TEXT,
  unit         TEXT NOT NULL DEFAULT 'даана',
  barcode      TEXT,
  oem_code     TEXT,
  description  TEXT,
  images       JSONB NOT NULL DEFAULT '[]',
  weight_kg    NUMERIC(10,3),                        -- приходдо милдеттүү (§9.1) — validation
  length_cm    NUMERIC(10,2),
  width_cm     NUMERIC(10,2),
  height_cm    NUMERIC(10,2),
  volume_m3    NUMERIC(10,4),
  chargeable_weight_kg NUMERIC(10,3),
  warranty_days INT,                                 -- NULL = категориянын демейкиси (§12-Б.7)
  compatibility_notes TEXT,                          -- MVP (§12-Б.8)
  min_stock    NUMERIC(12,2) NOT NULL DEFAULT 0,
  reorder_point NUMERIC(12,2) NOT NULL DEFAULT 0,
  base_markup_pct NUMERIC(6,2),                      -- §13
  min_selling_price NUMERIC(14,2),                   -- §13.2
  reservation_advance_required BOOLEAN NOT NULL DEFAULT false, -- §17.3 Product-level
  reservation_min_advance_pct NUMERIC(5,2),
  main_supplier_id UUID,                             -- FK төмөндө
  supplier_product_code TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Структураланган Compatibility — §12-Б.8 (Приоритет 3). MVP'деги
-- products.compatibility_notes ордунда калат: эркин жазылган эскертүү менен
-- текшерилген байланыш эки башка нерсе.
CREATE TABLE vehicle_models (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand      TEXT,
  name       TEXT NOT NULL,
  notes      TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_models_brand_name_key
    UNIQUE NULLS NOT DISTINCT (brand, name)
);

-- UNVERIFIED — айтылган; VERIFIED — ким жана качан текшергени жазылган.
CREATE TABLE product_compatibility (
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  model_id    UUID NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
  cstatus     compatibility_status NOT NULL DEFAULT 'UNVERIFIED',
  note        TEXT,
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, model_id),
  CONSTRAINT product_compatibility_verified_check
    CHECK (cstatus <> 'VERIFIED'
           OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX idx_compatibility_model ON product_compatibility(model_id);

CREATE TABLE product_aliases (                       -- §12-Б.2
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'OTHER'           -- RU/KG/SUPPLIER/KEYWORD/OEM
);
CREATE INDEX idx_aliases_search ON product_aliases USING gin (to_tsvector('simple', alias));

CREATE TABLE warehouses (                            -- §12-А.1
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  wtype       warehouse_type NOT NULL,
  address     TEXT,
  responsible_user UUID REFERENCES users(id),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT NOT NULL,
  contact   TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE products ADD CONSTRAINT fk_products_supplier
  FOREIGN KEY (main_supplier_id) REFERENCES suppliers(id);

CREATE TABLE cargo_companies (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE customers (                             -- §11, §12
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_walk_in    BOOLEAN NOT NULL DEFAULT false,      -- §11.1 (система бир гана Walk-in кармайт)
  name          TEXT NOT NULL,
  phone         TEXT,
  ctype         customer_type NOT NULL DEFAULT 'RETAIL',
  category      customer_category NOT NULL DEFAULT 'STANDARD',
  category_manual_override BOOLEAN NOT NULL DEFAULT false, -- §12.1
  individual_credit_limit NUMERIC(14,2),             -- §16.1
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_single_walkin ON customers(is_walk_in) WHERE is_walk_in = true;
CREATE INDEX idx_customers_phone ON customers(phone);

-- ============================================================================
-- 5. САТЫП АЛУУ жана КОНТРАГЕНТ ЛЕДЖЕРЛЕРИ  (§4, §5, §6)
-- ============================================================================

-- Purchase (PUR) — §4.1, логистикалык статус §6
CREATE TABLE purchases (
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  cargo_company_id UUID REFERENCES cargo_companies(id),
  logistics_status purchase_status NOT NULL DEFAULT 'DRAFT'
);

CREATE TABLE purchase_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES purchases(document_id),
  product_id  UUID NOT NULL REFERENCES products(id),
  qty         NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  price_cny   NUMERIC(14,2) NOT NULL CHECK (price_cny >= 0)
);

-- §6: ар бир статус үчүн дата/убакыт/жооптуу
CREATE TABLE purchase_status_history (
  id          BIGSERIAL PRIMARY KEY,
  purchase_id UUID NOT NULL REFERENCES purchases(document_id),
  status      purchase_status NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id),
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Поставщик леджери (CNY): Payable, Payment, Prepayment, Receivable — §4.2, §4.3, §8.2, §8.3
-- Баланс = SUM(amount_cny): терс = биз карызбыз (Payable), оң = поставщик бизге карыз.
CREATE TABLE supplier_ledger (
  id          BIGSERIAL PRIMARY KEY,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  document_id UUID NOT NULL REFERENCES documents(id), -- RCV(payable −), SPY(+), DIF/CLM(+/−)
  entry_type  TEXT NOT NULL,      -- PAYABLE / PAYMENT / PREPAYMENT / PREPAYMENT_APPLY / RECEIVABLE / RECEIVABLE_CLOSE / WRITEOFF
  amount_cny  NUMERIC(14,2) NOT NULL,
  kgs_value   NUMERIC(14,2),      -- FX эсеби үчүн (§10)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_supplier_ledger ON supplier_ledger(supplier_id);

-- Карго леджери (USD) — §5.2, §8.5 CARGO_CLAIM
CREATE TABLE cargo_ledger (
  id          BIGSERIAL PRIMARY KEY,
  cargo_company_id UUID NOT NULL REFERENCES cargo_companies(id),
  document_id UUID NOT NULL REFERENCES documents(id),
  entry_type  TEXT NOT NULL,      -- PAYABLE / PAYMENT / RECEIVABLE / WRITEOFF
  amount_usd  NUMERIC(14,2) NOT NULL,
  kgs_value   NUMERIC(14,2),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supplier Payment (SPY) — §4.1, §4.3: карыз бөлүгү + prepayment бөлүгү
CREATE TABLE supplier_payments (
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  from_account UUID NOT NULL REFERENCES payment_accounts(id), -- CNY касса
  amount_cny  NUMERIC(14,2) NOT NULL CHECK (amount_cny > 0),
  kgs_value   NUMERIC(14,2) NOT NULL,   -- currency_layer_consumptions суммасы
  debt_part_cny NUMERIC(14,2) NOT NULL DEFAULT 0,
  prepay_part_cny NUMERIC(14,2) NOT NULL DEFAULT 0,
  fx_gain_loss_kgs NUMERIC(14,2) NOT NULL DEFAULT 0,  -- §10.2
  channel     TEXT,                      -- Alipay / WeChat / Bank
  purchase_id UUID REFERENCES purchases(document_id)  -- optional: §4.2 төлөм статусу
);
CREATE INDEX idx_spy_purchase ON supplier_payments(purchase_id);

-- Cargo Payment (CPY) — §5.2
CREATE TABLE cargo_payments (
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  cargo_company_id UUID NOT NULL REFERENCES cargo_companies(id),
  from_account UUID NOT NULL REFERENCES payment_accounts(id), -- USD же KGS
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency    currency_code NOT NULL,
  rate        NUMERIC(12,6),
  kgs_value   NUMERIC(14,2) NOT NULL,
  fx_gain_loss_kgs NUMERIC(14,2) NOT NULL DEFAULT 0
);

-- ============================================================================
-- 6. ПРИХОД, LOT, ALLOCATION  (§7, §9, §18.1)
-- ============================================================================

-- Receipt (RCV) — §7
CREATE TABLE receipts (
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  purchase_id UUID NOT NULL REFERENCES purchases(document_id),
  rstatus     receipt_status NOT NULL DEFAULT 'DRAFT',
  rate_cny    NUMERIC(12,6),
  rate_cny_source rate_source,          -- §10.1
  rate_usd    NUMERIC(12,6),
  rate_usd_source rate_source
);

-- Приходдун түз чыгымдары — §5, §9: ар биринин өз allocation basis'и
CREATE TABLE receipt_expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id  UUID NOT NULL REFERENCES receipts(document_id),
  etype       receipt_expense_type NOT NULL,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency    currency_code NOT NULL,
  rate        NUMERIC(12,6),
  rate_source rate_source,
  kgs_amount  NUMERIC(14,2) NOT NULL,   -- allocation ушул суммадан жүрөт
  alloc_basis expense_alloc_basis NOT NULL DEFAULT 'WEIGHT', -- §9.2
  is_paid     BOOLEAN NOT NULL DEFAULT false
);

-- Приходдун позициялары — §7, §8.1
--
-- LOT приход ТАСТЫКТАЛГАНДА гана түзүлөт (§18.1), ошондуктан DRAFT/READY
-- абалында фактически кабыл алынган сандар ушул жерде турат. Тастыкталганда
-- ар бир сап lot_items'ке айланат.
CREATE TABLE receipt_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id   UUID NOT NULL REFERENCES receipts(document_id),
  product_id   UUID NOT NULL REFERENCES products(id),
  -- Позициянын документтеги туруктуу тартиби — §9.9 эреже 5 (tie-break).
  position     INT NOT NULL,
  ordered_qty  NUMERIC(12,2) NOT NULL CHECK (ordered_qty >= 0),
  received_qty NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  -- Кабыл алынгандын ичинен брак болгону (§8.4 v2.1): DEFECT складга кирет,
  -- landed cost'у ошол эле. received_qty'ге КИРЕТ — физикалык кабыл алынган.
  damaged_qty  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  CHECK (damaged_qty <= received_qty),
  UNIQUE (receipt_id, product_id)
);
CREATE INDEX idx_receipt_items_receipt ON receipt_items(receipt_id, position);

-- MANUAL allocation'дын киргизилген суммалары — §9.6
-- LOT жок кезде OWNER сумманы receipt позициясына жазат; тастыкталганда
-- expense_allocations'ке lot_item боюнча көчөт.
CREATE TABLE receipt_expense_manual_allocations (
  id              BIGSERIAL PRIMARY KEY,
  expense_id      UUID NOT NULL REFERENCES receipt_expenses(id) ON DELETE CASCADE,
  receipt_item_id UUID NOT NULL REFERENCES receipt_items(id) ON DELETE CASCADE,
  amount_kgs      NUMERIC(14,2) NOT NULL CHECK (amount_kgs >= 0),
  UNIQUE (expense_id, receipt_item_id)
);

-- LOT — §18.1: приход тастыкталганда түзүлөт
CREATE TABLE lots (
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  receipt_id  UUID NOT NULL REFERENCES receipts(document_id),
  purchase_id UUID NOT NULL REFERENCES purchases(document_id),
  total_weight_kg NUMERIC(12,3),
  total_landed_cost_kgs NUMERIC(14,2)
);

-- LOT Item — §18.1.2
CREATE TABLE lot_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id      UUID NOT NULL REFERENCES lots(document_id),
  product_id  UUID NOT NULL REFERENCES products(id),
  ordered_qty NUMERIC(12,2) NOT NULL,
  received_qty NUMERIC(12,2) NOT NULL CHECK (received_qty >= 0),
  unit_weight_kg NUMERIC(10,3) NOT NULL,             -- §9.1 милдеттүү
  purchase_price_cny NUMERIC(14,2) NOT NULL,
  purchase_cost_kgs  NUMERIC(14,2) NOT NULL,
  unit_landed_cost   NUMERIC(14,4) NOT NULL,         -- §9.7: бекитилгенден кийин ӨЗГӨРБӨЙТ
  damaged_qty NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0), -- §8.4: DEFECT'ке
  CONSTRAINT lot_items_damaged_qty_check1 CHECK (damaged_qty <= received_qty)
);

-- Allocation аудити — §9.6, §9.9: Σ allocated = expense.kgs_amount (0.01 тактыкта)
CREATE TABLE expense_allocations (
  id          BIGSERIAL PRIMARY KEY,
  expense_id  UUID NOT NULL REFERENCES receipt_expenses(id),
  lot_item_id UUID NOT NULL REFERENCES lot_items(id),
  amount_kgs  NUMERIC(14,2) NOT NULL
);

-- ============================================================================
-- 7. FIFO LAYERS жана STOCK  (§12-А, §18, §18.0)
-- ============================================================================

-- Бирдиктүү FIFO катмары: PURCHASE (lot_item), RETURN (§18.0), OPENING (§40.1), ADJUSTMENT (§22)
CREATE TABLE fifo_layers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID NOT NULL REFERENCES products(id),
  source       fifo_layer_source NOT NULL,
  lot_item_id  UUID REFERENCES lot_items(id),        -- source=PURCHASE болсо
  source_doc_id UUID REFERENCES documents(id),       -- RET/INV/OPENING документи
  layer_date   DATE NOT NULL,                        -- FIFO кезеги ушуга таянат
  unit_cost    NUMERIC(14,4) NOT NULL,
  initial_qty  NUMERIC(12,2) NOT NULL CHECK (initial_qty > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fifo_order ON fifo_layers(product_id, layer_date, created_at);

-- Катмардын склад боюнча калдыгы: Product + Warehouse + Layer (§12-А.2)
-- Transfer бир катмардын ичинде складдан складга кыймыл (§12-А.5: cost өзгөрбөйт)
CREATE TABLE layer_stock (
  layer_id     UUID NOT NULL REFERENCES fifo_layers(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  qty          NUMERIC(12,2) NOT NULL CHECK (qty >= 0),  -- §42.5: терс болбойт
  PRIMARY KEY (layer_id, warehouse_id)
);

-- Бардык складдык кыймыл документке байланышат (§42.4)
CREATE TABLE stock_movements (
  id           BIGSERIAL PRIMARY KEY,
  mtype        stock_movement_type NOT NULL,
  layer_id     UUID NOT NULL REFERENCES fifo_layers(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  qty          NUMERIC(12,2) NOT NULL,       -- кирүү +, чыгуу −
  unit_cost    NUMERIC(14,4) NOT NULL,
  document_id  UUID NOT NULL REFERENCES documents(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_mov_doc ON stock_movements(document_id);

-- Warehouse Transfer (TRF) — §12-А.4
CREATE TABLE warehouse_transfers (
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  from_warehouse UUID NOT NULL REFERENCES warehouses(id),
  to_warehouse   UUID NOT NULL REFERENCES warehouses(id),
  tstatus     transfer_status NOT NULL DEFAULT 'DRAFT',
  sent_by     UUID REFERENCES users(id),
  received_by UUID REFERENCES users(id),
  sent_at     TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  CHECK (from_warehouse != to_warehouse)
);

CREATE TABLE warehouse_transfer_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES warehouse_transfers(document_id),
  layer_id    UUID NOT NULL REFERENCES fifo_layers(id),
  qty         NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  unit_cost   NUMERIC(14,4) NOT NULL      -- маалымат үчүн; катмардан өзгөрбөйт
);

-- ============================================================================
-- 8. РАСХОЖДЕНИЕ жана CLAIM  (§8)
-- ============================================================================

CREATE TABLE discrepancies (                 -- DIF
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  receipt_id  UUID NOT NULL REFERENCES receipts(document_id),
  purchase_id UUID NOT NULL REFERENCES purchases(document_id),
  product_id  UUID NOT NULL REFERENCES products(id),
  ordered_qty NUMERIC(12,2) NOT NULL,
  received_qty NUMERIC(12,2) NOT NULL,
  diff_qty    NUMERIC(12,2) NOT NULL,
  dtype       discrepancy_type NOT NULL,
  dstatus     discrepancy_status NOT NULL DEFAULT 'OPEN',
  financial_decision TEXT
);

CREATE TABLE claims (                        -- CLM — §8.5
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  ctype       claim_type NOT NULL,
  discrepancy_id UUID REFERENCES discrepancies(document_id),
  supplier_id UUID REFERENCES suppliers(id),
  cargo_company_id UUID REFERENCES cargo_companies(id),
  amount      NUMERIC(14,2) NOT NULL,
  currency    currency_code NOT NULL,
  cstatus     claim_status NOT NULL DEFAULT 'OPEN',
  writeoff_reason TEXT,                      -- §8.5: WRITTEN_OFF'то милдеттүү
  CHECK ((ctype='SUPPLIER_CLAIM' AND supplier_id IS NOT NULL)
      OR (ctype='CARGO_CLAIM' AND cargo_company_id IS NOT NULL)),
  CONSTRAINT claims_check1
    CHECK (cstatus <> 'WRITTEN_OFF' OR writeoff_reason IS NOT NULL)
);

CREATE TABLE claim_compensations (           -- §8.7
  id          BIGSERIAL PRIMARY KEY,
  claim_id    UUID NOT NULL REFERENCES claims(document_id),
  receipt_id  UUID REFERENCES receipts(document_id),  -- товар менен компенсация
  amount      NUMERIC(14,2) NOT NULL,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 9. САТУУ, ТӨЛӨМ, КАРЫЗ  (§13–16-А)
-- ============================================================================

CREATE TABLE sales (                          -- SAL / LSS (is_loss_sale)
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  salesperson UUID NOT NULL REFERENCES users(id),
  is_loss_sale BOOLEAN NOT NULL DEFAULT false,       -- §13.6 (LSS префикси менен)
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cogs   NUMERIC(14,2) NOT NULL DEFAULT 0,     -- FIFO COGS (тастыкталганда бекийт)
  paid_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,     -- PAY allocation'дан жаңыртылат
  outstanding_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  debt_due_date DATE,                                 -- карызга сатууда милдеттүү (§16)
  debt_status  debt_status,
  from_reservation UUID REFERENCES documents(id),     -- RSV байланышы
  fiscal_receipt_no TEXT,                             -- §45 келечек үчүн орун
  owner_approval_user UUID REFERENCES users(id),      -- §13.5
  owner_approval_reason TEXT,
  -- §13.5: скидка кызматкердин лимитинен ашса, сатуу OWNER бекиткенге чейин
  -- тастыкталбайт. NULL = approval талап кылынган жок.
  approval_status approval_status,
  approval_requested_at TIMESTAMPTZ,
  approval_decided_at   TIMESTAMPTZ
);
CREATE INDEX idx_sales_customer ON sales(customer_id);
CREATE INDEX idx_sales_due ON sales(debt_due_date) WHERE debt_status IN ('OPEN','PARTIALLY_PAID');

CREATE TABLE sale_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     UUID NOT NULL REFERENCES sales(document_id),
  product_id  UUID NOT NULL REFERENCES products(id),
  qty         NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  auto_price  NUMERIC(14,2) NOT NULL,        -- система сунуштаган баа (§13)
  final_price NUMERIC(14,2) NOT NULL,        -- скидкадан кийин
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_reason TEXT,
  fifo_cogs   NUMERIC(14,2) NOT NULL DEFAULT 0,
  returned_qty NUMERIC(12,2) NOT NULL DEFAULT 0      -- §35.7: <= qty
);

-- Sale LOT Allocation — §18.1.4
CREATE TABLE sale_layer_allocations (
  id           BIGSERIAL PRIMARY KEY,
  sale_item_id UUID NOT NULL REFERENCES sale_items(id),
  layer_id     UUID NOT NULL REFERENCES fifo_layers(id),
  qty          NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  unit_cost    NUMERIC(14,4) NOT NULL,
  returned_qty NUMERIC(12,2) NOT NULL DEFAULT 0      -- возврат ушул саптарга таянат
);

-- Кардар төлөмү (PAY) — §16-А
-- Сатуунун өз төлөм саптары — §15 (mixed payment), §15.2 (сдача)
--
-- customer_payment_lines кийинки PAY документине тиешелүү; сатуу учурунда
-- алынган акча ушул жерде. Сдача Cash эсебинен гана берилет, ошондуктан
-- change_given нөлдөн чоң болсо эсеп Cash болушу керек — аны service
-- текшерет (эсептин тиби бул таблицада көрүнбөйт).
CREATE TABLE sale_payment_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     UUID NOT NULL REFERENCES sales(document_id),
  account_id  UUID NOT NULL REFERENCES payment_accounts(id),
  -- Сатуунун эсебине жазылган таза сумма (сдача кемитилген).
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  cash_given  NUMERIC(14,2),                 -- кардар берген накталай (§15.1)
  change_given NUMERIC(14,2),                -- кайтарылган сдача (§15.2)
  CONSTRAINT sale_payment_lines_change_check
    CHECK (change_given IS NULL OR (cash_given IS NOT NULL AND change_given >= 0)),
  CONSTRAINT sale_payment_lines_cash_check
    CHECK (cash_given IS NULL OR cash_given >= amount)
);
CREATE INDEX idx_sale_payment_lines_sale ON sale_payment_lines(sale_id);

CREATE TABLE customer_payments (
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
  overpay_advance_doc UUID REFERENCES documents(id)  -- §16-А.5: ашыкча → ADV
);

CREATE TABLE customer_payment_lines (        -- mixed payment (§15)
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  UUID NOT NULL REFERENCES customer_payments(document_id),
  account_id  UUID NOT NULL REFERENCES payment_accounts(id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  cash_given  NUMERIC(14,2),                 -- накталай берилди (§15.1)
  change_given NUMERIC(14,2)                 -- сдача — Cash гана (§15.2)
);

-- Payment Allocation — §16-А: төлөм кайсы Sale'ды канчага жапты
CREATE TABLE payment_allocations (
  id          BIGSERIAL PRIMARY KEY,
  payment_id  UUID NOT NULL REFERENCES customer_payments(document_id),
  sale_id     UUID NOT NULL REFERENCES sales(document_id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  is_manual   BOOLEAN NOT NULL DEFAULT false -- §16-А.2
);

-- OWNER Override журналы — §16.5
CREATE TABLE credit_overrides (
  id          BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id),
  sale_id     UUID REFERENCES sales(document_id),
  reservation_id UUID REFERENCES documents(id),
  owner_id    UUID NOT NULL REFERENCES users(id),
  reason      TEXT NOT NULL,
  open_debt   NUMERIC(14,2) NOT NULL,
  overdue_amount NUMERIC(14,2) NOT NULL,
  credit_limit NUMERIC(14,2) NOT NULL,
  new_debt    NUMERIC(14,2) NOT NULL,
  projected_debt NUMERIC(14,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 10. БРОНЬ жана АВАНС  (§17, §17-А)
-- ============================================================================

CREATE TABLE reservations (                   -- RSV
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  salesperson UUID NOT NULL REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,           -- §17: милдеттүү
  rstatus     reservation_status NOT NULL DEFAULT 'ACTIVE',
  total_amount NUMERIC(14,2) NOT NULL,
  advance_required NUMERIC(14,2) NOT NULL DEFAULT 0, -- §17.3
  cancel_reason TEXT,
  fulfilled_sale UUID REFERENCES sales(document_id)
);

CREATE TABLE reservation_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(document_id),
  product_id  UUID NOT NULL REFERENCES products(id),
  qty         NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  fixed_price NUMERIC(14,2) NOT NULL          -- §17.1: баа фиксацияланат
);
-- Reserved Stock = ACTIVE брондордун суммасы; Available = Stock − Reserved (§12-Б.4)

CREATE TABLE advances (                       -- ADV — §17-А.6
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  reservation_id UUID REFERENCES reservations(document_id),
  from_payment_id UUID REFERENCES documents(id),  -- §16-А.5 ашыкча төлөмдөн
  account_id  UUID NOT NULL REFERENCES payment_accounts(id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  astatus     advance_status NOT NULL DEFAULT 'ACTIVE',
  applied_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  refunded_amount NUMERIC(14,2) NOT NULL DEFAULT 0
);

-- Аванс кайтаруу саптары (§17-А.4: debt offset + refund source приоритети)
CREATE TABLE advance_refund_lines (
  id          BIGSERIAL PRIMARY KEY,
  advance_id  UUID NOT NULL REFERENCES advances(document_id),
  account_id  UUID REFERENCES payment_accounts(id), -- NULL = Debt Offset бөлүгү
  sale_id     UUID REFERENCES sales(document_id),   -- offset кайсы карызды жапты
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  source_override_reason TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 11. ВОЗВРАТ, БРАК, СПИСАНИЕ, OIN  (§35–38)
-- ============================================================================

CREATE TABLE returns (                        -- RET — §35
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  original_sale UUID NOT NULL REFERENCES sales(document_id), -- §35.1: exception ЖОК
  customer_id UUID NOT NULL REFERENCES customers(id),
  total_return_amount NUMERIC(14,2) NOT NULL,
  debt_offset NUMERIC(14,2) NOT NULL DEFAULT 0,  -- §35.4
  cash_refund NUMERIC(14,2) NOT NULL DEFAULT 0,
  reason      TEXT NOT NULL
);

CREATE TABLE return_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id   UUID NOT NULL REFERENCES returns(document_id),
  sale_item_id UUID NOT NULL REFERENCES sale_items(id),
  qty         NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  condition   return_condition NOT NULL,       -- RESALABLE → MAIN, DEFECT → DEFECT (§35.2)
  original_price NUMERIC(14,2) NOT NULL,
  original_unit_cost NUMERIC(14,4) NOT NULL,   -- §18.0: жаңы layer ушул нарк менен
  new_layer_id UUID REFERENCES fifo_layers(id),
  warranty_ok BOOLEAN,                          -- §36-А.2 текшерүү жыйынтыгы
  owner_exception_reason TEXT                   -- кепилдик мөөнөтү өтсө (§36-А.2)
);

CREATE TABLE refund_lines (                    -- §35.5: split refund, source приоритет
  id          BIGSERIAL PRIMARY KEY,
  return_id   UUID NOT NULL REFERENCES returns(document_id),
  account_id  UUID NOT NULL REFERENCES payment_accounts(id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  source_override_reason TEXT                  -- §35.5.4
);

CREATE TABLE defect_acts (                     -- DEF — §36, §37
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  return_id   UUID REFERENCES returns(document_id),
  discrepancy_id UUID REFERENCES discrepancies(document_id), -- RECEIVING_DAMAGE
  product_id  UUID NOT NULL REFERENCES products(id),
  qty         NUMERIC(12,2) NOT NULL,
  reason      TEXT NOT NULL,
  decision    TEXT,                            -- EXCHANGE / REFUND / CLAIM / WRITEOFF
  checked_by  UUID REFERENCES users(id)
);

CREATE TABLE write_offs (                      -- WOF — §38
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  total_cost  NUMERIC(14,2) NOT NULL
);

CREATE TABLE write_off_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  write_off_id UUID NOT NULL REFERENCES write_offs(document_id),
  layer_id    UUID NOT NULL REFERENCES fifo_layers(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id), -- DEFECT
  qty         NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  unit_cost   NUMERIC(14,4) NOT NULL
);

CREATE TABLE other_income (                    -- OIN — §38 (v2.1)
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  category    TEXT NOT NULL,                   -- METAL_SALE / OTHER
  account_id  UUID NOT NULL REFERENCES payment_accounts(id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  linked_write_off UUID REFERENCES write_offs(document_id)
);

-- ============================================================================
-- 12. ЧЫГЫМ, АЙЛЫК, БОНУС  (§23, §25, §26)
-- ============================================================================

CREATE TABLE expense_categories (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  monthly_budget NUMERIC(14,2)                 -- §26 келечектеги лимит
);

CREATE TABLE expenses (                        -- EXP — §26
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  category_id UUID NOT NULL REFERENCES expense_categories(id),
  account_id  UUID NOT NULL REFERENCES payment_accounts(id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0)
);

CREATE TABLE salary_payments (                 -- SLR — §25
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  employee_id UUID NOT NULL REFERENCES users(id),
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  base_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  bonus_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  advance_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  deduction   NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_paid  NUMERIC(14,2) NOT NULL,
  account_id  UUID NOT NULL REFERENCES payment_accounts(id)
);

CREATE TABLE bonuses (                         -- §23
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     UUID NOT NULL UNIQUE REFERENCES sales(document_id),
  employee_id UUID NOT NULL REFERENCES users(id),
  revenue     NUMERIC(14,2) NOT NULL,
  fifo_cogs   NUMERIC(14,2) NOT NULL,
  bonus_base  NUMERIC(14,2) NOT NULL,
  bonus_rate  NUMERIC(5,2) NOT NULL,
  calculated_amount NUMERIC(14,2) NOT NULL,
  adjustment_amount NUMERIC(14,2) NOT NULL DEFAULT 0, -- §23.4
  payable_amount NUMERIC(14,2) NOT NULL,
  bstatus     bonus_status NOT NULL DEFAULT 'CALCULATED',
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payable_at  TIMESTAMPTZ,                     -- Sale Outstanding = 0 болгондо (§23.2)
  paid_at     TIMESTAMPTZ,
  payment_doc UUID REFERENCES documents(id)    -- BON
);

CREATE TABLE bonus_payments (                  -- BON
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  employee_id UUID NOT NULL REFERENCES users(id),
  account_id  UUID NOT NULL REFERENCES payment_accounts(id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0)
);

-- План жана KPI — §24. user_id NULL = бүтүндөй бизнестин планы.
-- Ар бир максат өзүнчө NULL боло алат: коюлбаган максат «план жок» дегенди
-- билдирет, «0%» эмес. NULLS NOT DISTINCT — бир айга бизнес боюнча эки план
-- түзүлбөшү үчүн (PostgreSQL 15+).
CREATE TABLE sales_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year   INT NOT NULL,
  period_month  INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  user_id       UUID REFERENCES users(id),
  revenue_target NUMERIC(14,2) CHECK (revenue_target IS NULL OR revenue_target >= 0),
  margin_target  NUMERIC(14,2) CHECK (margin_target IS NULL OR margin_target >= 0),
  new_customers_target INT CHECK (new_customers_target IS NULL OR new_customers_target >= 0),
  comment       TEXT,
  created_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sales_plans_period_user_key
    UNIQUE NULLS NOT DISTINCT (period_year, period_month, user_id)
);
CREATE INDEX idx_sales_plans_period ON sales_plans(period_year, period_month);

-- ============================================================================
-- 13. ИНВЕНТАРИЗАЦИЯ, СКЛАД ӨТКӨРҮҮ, КОРРЕКЦИЯ  (§21, §22, §27.1, Period Lock)
-- ============================================================================

CREATE TABLE inventories (                     -- INV — §22
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  is_full     BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE inventory_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL REFERENCES inventories(document_id),
  product_id  UUID NOT NULL REFERENCES products(id),
  layer_id    UUID REFERENCES fifo_layers(id), -- LOT деңгээли (§22 v2.1)
  system_qty  NUMERIC(12,2) NOT NULL,
  actual_qty  NUMERIC(12,2) NOT NULL,
  diff_qty    NUMERIC(12,2) NOT NULL,
  responsible UUID REFERENCES users(id)
);

CREATE TABLE handover_acts (                   -- HND — §21.1
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  from_user   UUID NOT NULL REFERENCES users(id),
  to_user     UUID NOT NULL REFERENCES users(id),
  total_value NUMERIC(14,2),
  difference  NUMERIC(14,2) NOT NULL DEFAULT 0,
  from_confirmed_at TIMESTAMPTZ,
  to_confirmed_at   TIMESTAMPTZ               -- экөө тең ырастаганда өтөт
);

CREATE TABLE handover_checked_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id UUID NOT NULL REFERENCES handover_acts(document_id),
  product_id  UUID NOT NULL REFERENCES products(id),
  is_a_class  BOOLEAN NOT NULL DEFAULT false,  -- кымбат товар / рандом
  system_qty  NUMERIC(12,2) NOT NULL,
  actual_qty  NUMERIC(12,2) NOT NULL
);

CREATE TABLE corrections (                     -- COR — Period Lock
  document_id UUID PRIMARY KEY REFERENCES documents(id),
  original_document_id UUID NOT NULL REFERENCES documents(id),
  correction_type TEXT NOT NULL,
  reason      TEXT NOT NULL,
  old_value   JSONB NOT NULL,
  new_value   JSONB NOT NULL,
  effective_date DATE NOT NULL                 -- Business/Effective Date
);


-- ============================================================================
-- 14. IDEMPOTENCY — кайталанган суроо-талаптан коргоо  (Connectivity бөлүмү)
-- ============================================================================

-- Online-only: интернет үзүлсө, клиент операция аяктаганын билбей кайра
-- жөнөтүшү мүмкүн. Ошол эле ачкыч менен келген суроо-талап кайра аткарылбайт —
-- сакталган жооп кайтарылат. Ачкыч колдонуучуга байланат: башка кызматкердин
-- ачкычы менен кокустан дал келүү болбойт.
CREATE TABLE idempotency_keys (
  key           TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(id),
  endpoint      TEXT NOT NULL,             -- 'POST /api/transfers'
  request_hash  TEXT NOT NULL,             -- дененин sha256'си
  status_code   INT,                       -- NULL = аткарылып жатат
  response_body JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  PRIMARY KEY (key, user_id)
);
CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);


-- ============================================================================
-- 15. ЭСКЕРТҮҮЛӨР  (§39)
-- ============================================================================

-- Ички эскертүүлөр. Push/telegram кийинки фазада; §39 «система автоматтык
-- эскертүү бере алат» дегенди талап кылат, каналды белгилебейт.
CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,             -- SUPPLIER_DEBT / CARGO_DEBT / LOW_CURRENCY_BALANCE
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  payload     JSONB,
  -- Бир эле эскертүү бир күндө кайталанбашы үчүн (мис.
  -- 'SUPPLIER_DEBT:2026-08-30'). Digest кайра иштесе да дубль болбойт.
  dedupe_key  TEXT NOT NULL,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX idx_notifications_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;

-- ============================================================================
-- АЯГЫ. Негизги инварианттар (application + тест деңгээлинде текшерилет):
--  1) Σ expense_allocations.amount_kgs = receipt_expenses.kgs_amount  (§9.9)
--  2) layer_stock.qty >= 0 ар дайым; sale FIFO эң эски layer_date'тен  (§18)
--  3) sale.final_price жыйындысы >= sale.total_cogs (is_loss_sale=false) (§13.4)
--  4) Σ payment_allocations = customer_payments.total − overpay→ADV     (§16-А)
--  5) return_items.qty <= sale_item.qty − returned_qty                  (§35.7)
--  6) documents.doc_number уникалдуу, sequence жыл боюнча               (Numbering)
--  7) Жабылган business_date'ке жаңы документ түзүлбөйт                 (Period Lock)
-- ============================================================================
