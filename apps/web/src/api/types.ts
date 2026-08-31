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

// ─────────────────────────────────────────────────────────────────────────
// Module 3 — receipt, landed cost, LOT/FIFO, warehouses
// ─────────────────────────────────────────────────────────────────────────

export type WarehouseType =
  | 'MAIN'
  | 'DEFECT'
  | 'SERVICE'
  | 'TRANSIT'
  | 'BRANCH'
  | 'OTHER';

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  wtype: WarehouseType;
  address: string | null;
  is_active: boolean;
}

export interface ProductStock {
  product_id: string;
  sku: string;
  name: string;
  current_qty: string;
  reserved_qty: string;
  available_qty: string;
  total_value_kgs: string;
  by_warehouse: {
    warehouse_id: string;
    code: string;
    wtype: WarehouseType;
    qty: string;
    value_kgs: string;
  }[];
}

export interface LayerView {
  layer_id: string;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_type: WarehouseType;
  qty: string;
  unit_cost: string;
  value_kgs: string;
  layer_date: string;
  source: string;
  lot_number: string | null;
}

export type ReceiptStatus = 'DRAFT' | 'READY' | 'RECEIVED' | 'CLOSED';

export type ExpenseType =
  | 'CHINA_TRANSPORT'
  | 'INTL_CARGO'
  | 'LOCAL_TRANSPORT'
  | 'INSURANCE'
  | 'COMMISSION'
  | 'OTHER';

export type AllocBasis = 'WEIGHT' | 'VOLUME' | 'VALUE' | 'MANUAL';
export type RateSource = 'FACTUAL' | 'REFERENCE' | 'MANUAL';

export interface ReceiptExpense {
  id: string;
  etype: ExpenseType;
  amount: string;
  currency: CurrencyCode;
  rate: string | null;
  rate_source: RateSource | null;
  kgs_amount: string;
  alloc_basis: AllocBasis;
  is_paid: boolean;
  receipt_expense_manual_allocations: {
    receipt_item_id: string;
    amount_kgs: string;
  }[];
}

export interface ReceiptItem {
  id: string;
  product_id: string;
  position: number;
  ordered_qty: string;
  received_qty: string;
  damaged_qty: string;
  products: {
    sku: string;
    name: string;
    weight_kg: string | null;
    chargeable_weight_kg: string | null;
  };
}

export interface Receipt {
  document_id: string;
  purchase_id: string;
  rstatus: ReceiptStatus;
  rate_cny: string | null;
  rate_cny_source: RateSource | null;
  rate_usd: string | null;
  rate_usd_source: RateSource | null;
  receipt_items: ReceiptItem[];
  receipt_expenses: ReceiptExpense[];
  purchases: {
    supplier_id: string;
    cargo_company_id: string | null;
    purchase_items: { product_id: string; qty: string; price_cny: string }[];
    suppliers: { id: string; name: string };
  };
}

export interface ReceiptProblem {
  code: string;
  product_id?: string;
  sku?: string;
  expense_id?: string;
  field?: string;
  message: string;
}

export interface CostedLine {
  line_id: string;
  product_id: string;
  sku: string;
  name: string;
  ordered_qty: string;
  received_qty: string;
  damaged_qty: string;
  unit_weight_kg: string;
  total_weight_kg: string;
  purchase_cost_cny: string;
  purchase_cost_kgs: string;
  allocated: { expense_id: string; amount_kgs: string }[];
  allocated_total_kgs: string;
  total_landed_cost_kgs: string;
  unit_landed_cost: string;
}

export interface CostingPreview {
  lines: CostedLine[];
  total_weight_kg: string;
  total_landed_cost_kgs: string;
}

export interface RateSuggestion {
  rate: string;
  source: RateSource;
  paid_amount: string;
  paid_rate: string | null;
  unpaid_amount: string;
  unpaid_rate: string | null;
}

export type DiscrepancyType =
  | 'SUPPLIER_SHORTAGE'
  | 'CARGO_LOSS'
  | 'LOCAL_TRANSPORT_LOSS'
  | 'RECEIVING_DAMAGE'
  | 'EXCESS'
  | 'UNKNOWN';

export type DiscrepancyStatus =
  | 'OPEN'
  | 'UNDER_REVIEW'
  | 'PARTIALLY_COMPENSATED'
  | 'COMPENSATED'
  | 'WRITTEN_OFF'
  | 'CLOSED';

export interface Discrepancy {
  document_id: string;
  receipt_id: string;
  purchase_id: string;
  product_id: string;
  ordered_qty: string;
  received_qty: string;
  diff_qty: string;
  dtype: DiscrepancyType;
  dstatus: DiscrepancyStatus;
  financial_decision: string | null;
  documents: { doc_number: string; business_date: string };
  products: { id: string; sku: string; name: string };
}

export type ClaimType = 'SUPPLIER_CLAIM' | 'CARGO_CLAIM';
export type ClaimStatus = DiscrepancyStatus;

export interface Claim {
  document_id: string;
  ctype: ClaimType;
  discrepancy_id: string | null;
  amount: string;
  currency: CurrencyCode;
  cstatus: ClaimStatus;
  writeoff_reason: string | null;
  documents: { doc_number: string; business_date: string };
  claim_compensations: {
    id: string;
    amount: string;
    receipt_id: string | null;
    comment: string | null;
    created_at: string;
  }[];
  compensated_total?: string;
  remaining?: string;
}

export type TransferStatus = 'DRAFT' | 'SENT' | 'RECEIVED' | 'CANCELLED';

export interface WarehouseTransfer {
  document_id: string;
  from_warehouse: string;
  to_warehouse: string;
  tstatus: TransferStatus;
  documents?: { doc_number: string; business_date: string };
}
