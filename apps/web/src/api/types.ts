/**
 * What the API returns.
 *
 * Every money field is a decimal *string*, exactly as the API sends it, and
 * it stays a string all the way to the screen. Parsing one into a JS number
 * would silently round it (CLAUDE.md: NUMERIC/Decimal only), and the UI never
 * needs to do arithmetic — every total the screens show is computed on the
 * server, where the Decimal type lives.
 */

export type UserRole =
  | 'OWNER'
  | 'SALES_MANAGER'
  | 'SELLER'
  | 'WAREHOUSE'
  | 'ACCOUNTANT';

export interface AuthUser {
  id: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
}

export interface LoginResult {
  access_token: string;
  user: AuthUser;
}

export type CurrencyCode = 'KGS' | 'CNY' | 'USD';

export interface AccountBalance {
  account_id: string;
  name: string;
  type: string;
  currency: CurrencyCode;
  is_active: boolean;
  balance: string;
}

export type PurchaseStatus =
  | 'DRAFT'
  | 'SENT_TO_SUPPLIER'
  | 'SUPPLIER_ACCEPTED'
  | 'COLLECTING'
  | 'LEFT_SUPPLIER'
  | 'ARRIVED_YIWU_CARGO'
  | 'CARGO_ACCEPTED'
  | 'LEFT_CARGO'
  | 'IN_TRANSIT'
  | 'ARRIVED_SVH'
  | 'RELEASED_SVH'
  | 'LOCAL_TRANSPORT'
  | 'ARRIVED_EGOMOT'
  | 'READY_TO_RECEIVE'
  | 'RECEIVED'
  | 'CLOSED';

export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface PurchaseListItem {
  document_id: string;
  doc_number: string;
  business_date: string;
  document_status: string;
  supplier: { id: string; name: string };
  logistics_status: PurchaseStatus;
  total_cny: string;
  paid_cny: string;
  payment_status: PaymentStatus;
}

export interface StageDuration {
  stage: number;
  status: PurchaseStatus;
  entered_at: string;
  /** Whole days spent at this stage; null while it is the current one. */
  days: number | null;
  user_id: string;
}

export interface PurchaseCard {
  document: {
    id: string;
    doc_number: string;
    status: string;
    business_date: string;
    comment: string | null;
  };
  supplier: { id: string; name: string; contact: string | null };
  cargo_company: { id: string; name: string } | null;
  logistics: {
    status: PurchaseStatus;
    stage: number;
    history: StageDuration[];
    lead_time_days: number | null;
  };
  items: {
    product_id: string;
    sku: string;
    name: string;
    qty: string;
    price_cny: string;
    line_total_cny: string;
  }[];
  totals: {
    total_cny: string;
    paid_cny: string;
    outstanding_cny: string;
    payment_status: PaymentStatus;
    total_kgs_reference: string | null;
    reference_rate: string | null;
    reference_rate_source: string | null;
  };
  payments: {
    document_id: string;
    amount_cny: string;
    kgs_value: string;
    fx_gain_loss_kgs: string | null;
  }[];
  supplier_balance_cny: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string | null;
  is_active: boolean;
}

export interface CargoCompany {
  id: string;
  name: string;
  contact: string | null;
  is_active: boolean;
}

export interface SupplierLedger {
  supplier_id: string;
  /** Negative = we owe; positive = an advance or a receivable (§4.2). */
  balance_cny: string;
  we_owe_cny: string;
  entries: SupplierLedgerEntry[];
}

export interface CargoLedger {
  cargo_company_id: string;
  balance_usd: string;
  we_owe_usd: string;
  on_deposit_usd: string;
  entries: CargoLedgerEntry[];
}

export interface SupplierLedgerEntry {
  id: string;
  document_id: string | null;
  entry_type: string;
  amount_cny: string;
  kgs_value: string | null;
  created_at: string;
}

export interface CargoLedgerEntry {
  id: string;
  document_id: string | null;
  entry_type: string;
  amount_usd: string;
  kgs_value: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  payload: unknown;
  read_at: string | null;
  created_at: string;
}

export interface NotificationList {
  unread_count: number;
  items: Notification[];
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  is_active: boolean;
}
