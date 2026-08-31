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
  /** Whose till it is (§19); null for a company-wide account. */
  owner_user: string | null;
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
  category_id: string | null;
  brand: string | null;
  unit: string;
  barcode: string | null;
  oem_code: string | null;
  description: string | null;
  compatibility_notes: string | null;
  warranty_days: number | null;
  weight_kg: string | null;
  length_cm: string | null;
  width_cm: string | null;
  height_cm: string | null;
  volume_m3: string | null;
  chargeable_weight_kg: string | null;
  min_stock: string;
  reorder_point: string;
  base_markup_pct: string | null;
  min_selling_price: string | null;
  main_supplier_id: string | null;
  supplier_product_code: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Module 5 — product catalogue (§12-Б)
// ─────────────────────────────────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
  /** §36-А.1 — what a product in it inherits when it sets no term. */
  default_warranty_days: number;
  product_count: number;
}

export type AliasKind = 'RU' | 'KG' | 'SUPPLIER' | 'KEYWORD' | 'OEM' | 'OTHER';

export interface ProductAlias {
  id: string;
  alias: string;
  kind: AliasKind;
}

export interface ProductCard {
  product: {
    id: string;
    sku: string;
    name: string;
    brand: string | null;
    unit: string;
    barcode: string | null;
    oem_code: string | null;
    description: string | null;
    compatibility_notes: string | null;
    is_active: boolean;
    weight_kg: string | null;
    length_cm: string | null;
    width_cm: string | null;
    height_cm: string | null;
    volume_m3: string | null;
    chargeable_weight_kg: string | null;
  };
  category: { id: string; name: string; default_warranty_days: number } | null;
  aliases: ProductAlias[];
  warranty: { days: number; source: 'PRODUCT' | 'CATEGORY' | 'NONE' };
  stock: {
    current_qty: string;
    reserved_qty: string;
    available_qty: string;
    total_value_kgs: string;
    inbound_qty: string;
    min_stock: string;
    reorder_point: string;
    below_minimum: boolean;
    needs_reorder: boolean;
    by_warehouse: ProductStock['by_warehouse'];
  };
  layers: LayerView[];
  purchasing: {
    main_supplier: { id: string; name: string } | null;
    supplier_product_code: string | null;
    last_purchase: {
      document_id: string;
      doc_number: string;
      business_date: string;
      price_cny: string;
      qty: string;
    } | null;
    last_receipt_date: string | null;
  };
  pricing: {
    base_markup_pct: string | null;
    min_selling_price: string | null;
    current_fifo_cost: string | null;
    indicative_price: string | null;
  };
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

// ─────────────────────────────────────────────────────────────────────────
// Module 4 — customers, pricing, sales, payment, debt
// ─────────────────────────────────────────────────────────────────────────

export type CustomerType = 'WHOLESALE' | 'RETAIL' | 'MASTER';
export type CustomerCategory = 'STANDARD' | 'SILVER' | 'GOLD' | 'VIP';

export interface Customer {
  id: string;
  is_walk_in: boolean;
  name: string;
  phone: string | null;
  ctype: CustomerType;
  category: CustomerCategory;
  category_manual_override: boolean;
  individual_credit_limit: string | null;
  is_active: boolean;
}

/** Everything §16.6 puts on the sale screen when a customer is chosen. */
export interface CreditStanding {
  customer_id: string;
  ctype: CustomerType;
  category: CustomerCategory;
  is_walk_in: boolean;
  effective_credit_limit: string | null;
  limit_source: 'INDIVIDUAL' | 'CATEGORY' | 'UNCONFIGURED';
  current_open_debt: string;
  overdue_amount: string;
  available_credit: string;
  has_overdue: boolean;
  oldest_unpaid_due_date: string | null;
  open_debts: {
    sale_id: string;
    doc_number: string;
    business_date: string;
    outstanding: string;
    due_date: string | null;
    is_overdue: boolean;
  }[];
}

export interface PriceSuggestion {
  product_id: string;
  sku: string;
  name: string;
  auto_price: string;
  min_selling_price: string | null;
  base_markup_pct: string | null;
  extra_markup_pct: string;
  unit_cost: string | null;
  customer: { id: string; ctype: CustomerType; category: CustomerCategory };
}

export type SaleBlockCode =
  | 'BELOW_COGS'
  | 'BELOW_MIN_PRICE'
  | 'DISCOUNT_OVER_LIMIT'
  | 'MISSING_DISCOUNT_REASON'
  | 'NEGATIVE_PRICE';

export interface SaleBlock {
  code: SaleBlockCode;
  product_id?: string;
  sku?: string;
  message: string;
  needs_owner_approval: boolean;
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SaleAssessment {
  sale_id: string;
  doc_number: string;
  status: string;
  is_loss_sale: boolean;
  customer: { id: string; name: string; is_walk_in: boolean };
  lines: {
    product_id: string;
    sku: string;
    name: string;
    qty: string;
    auto_price: string;
    final_price: string;
    line_total: string;
    fifo_cogs: string | null;
  }[];
  totals: {
    auto_total: string;
    total: string;
    discount_amount: string;
    discount_pct: string;
    fifo_cogs: string | null;
    margin: string | null;
  };
  payment: { paid: string; change: string; outstanding: string };
  blocks: SaleBlock[];
  approval_status: ApprovalStatus | null;
  pin_required: boolean;
  pin_reasons: string[];
}

export interface SaleListItem {
  document_id: string;
  customer_id: string;
  salesperson: string;
  is_loss_sale: boolean;
  total_amount: string;
  paid_amount: string;
  outstanding_amount: string;
  debt_due_date: string | null;
  debt_status: 'OPEN' | 'PARTIALLY_PAID' | 'CLOSED' | null;
  documents_sales_document_idTodocuments: {
    doc_number: string;
    business_date: string;
    status: string;
  };
  customers: { id: string; name: string; is_walk_in: boolean };
  sale_items: {
    qty: string;
    final_price: string;
    products: { sku: string; name: string };
  }[];
}

export interface CustomerPayment {
  document_id: string;
  customer_id: string;
  total_amount: string;
  overpay_advance_doc: string | null;
  payment_allocations: {
    id: string;
    sale_id: string;
    amount: string;
    is_manual: boolean;
  }[];
  customers: { id: string; name: string };
  documents_customer_payments_document_idTodocuments: {
    doc_number: string;
    business_date: string;
    status: string;
  };
}

export type AdvanceStatus =
  | 'ACTIVE'
  | 'PARTIALLY_APPLIED'
  | 'APPLIED'
  | 'REFUNDED'
  | 'CANCELLED';

export interface Advance {
  document_id: string;
  customer_id: string;
  /** The reservation this backs, when it backs one (§17.3). */
  reservation_id: string | null;
  account_id: string;
  amount: string;
  astatus: AdvanceStatus;
  applied_amount: string;
  refunded_amount: string;
  documents_advances_document_idTodocuments: {
    doc_number: string;
    business_date: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Module 6 — reservation (RSV) and advance (ADV), §17 and §17-А
// ─────────────────────────────────────────────────────────────────────────

export type ReservationStatus = 'ACTIVE' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED';

export interface Reservation {
  document: {
    id: string;
    doc_number: string;
    status: string;
    business_date: string;
    comment: string | null;
  };
  customer: { id: string; name: string };
  salesperson: string;
  status: ReservationStatus;
  /** True only while the hold actually stands (§17.3). */
  is_live: boolean;
  expires_at: string;
  total_amount: string;
  advance_required: string;
  advance_paid: string;
  advance_outstanding: string;
  cancel_reason: string | null;
  fulfilled_sale: string | null;
  items: {
    product_id: string;
    sku: string;
    name: string;
    qty: string;
    fixed_price: string;
    line_total: string;
  }[];
}

// ─────────────────────────────────────────────────────────────────────────
// Module 7 — inventory (INV) and warehouse handover (HND), §21 and §22
// ─────────────────────────────────────────────────────────────────────────

export interface InventoryLine {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  system_qty: string;
  actual_qty: string;
  diff_qty: string;
  layer_id: string | null;
  responsible: string | null;
}

export interface Inventory {
  document: {
    id: string;
    doc_number: string;
    status: string;
    business_date: string;
    comment: string | null;
  };
  warehouse: { id: string; code: string; name: string };
  is_full: boolean;
  lines: InventoryLine[];
  counted_lines: number;
  total_lines: number;
  shortage_lines: number;
  excess_lines: number;
}

export interface HandoverItem {
  id: string;
  product_id: string;
  /** Counted at every handover, whatever the sample says (§21.1). */
  is_a_class: boolean;
  system_qty: string;
  actual_qty: string;
}

export interface Handover {
  document_id: string;
  from_user: string;
  to_user: string;
  total_value: string | null;
  difference: string;
  from_confirmed_at: string | null;
  to_confirmed_at: string | null;
  handover_checked_items: HandoverItem[];
  documents: {
    doc_number: string;
    status: string;
    business_date: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Module 8 — return (RET), §35 and the §36-А.2 warranty check
// ─────────────────────────────────────────────────────────────────────────

export type ReturnCondition = 'RESALABLE' | 'DEFECT';

export interface ReturnDoc {
  document: {
    id: string;
    doc_number: string;
    status: string;
    business_date: string;
    comment: string | null;
  };
  original_sale: { id: string; doc_number: string };
  customer: { id: string; name: string };
  reason: string;
  total_return_amount: string;
  debt_offset: string;
  cash_refund: string;
  items: {
    id: string;
    sale_item_id: string;
    sku: string;
    name: string;
    qty: string;
    condition: ReturnCondition;
    original_price: string;
    original_unit_cost: string;
    /** §36-А.2 — null unless the line is a defect return. */
    warranty_ok: boolean | null;
    owner_exception_reason: string | null;
    new_layer_id: string | null;
  }[];
  refunds: {
    account_id: string;
    account_name: string;
    amount: string;
    source_override_reason: string | null;
  }[];
}

/** One sale as `GET /sales/:id` returns it — the shape a return works from. */
export interface SaleDetail {
  document_id: string;
  customer_id: string;
  total_amount: string;
  outstanding_amount: string;
  customers: { id: string; name: string; is_walk_in: boolean };
  sale_items: {
    id: string;
    product_id: string;
    qty: string;
    returned_qty: string;
    final_price: string;
    fifo_cogs: string;
    products: { sku: string; name: string };
  }[];
  sale_payment_lines: { account_id: string; amount: string }[];
}

// ─────────────────────────────────────────────────────────────────────────
// Module 9 — defect act (DEF), write-off (WOF) and scrap income (OIN), §37, §38
// ─────────────────────────────────────────────────────────────────────────

export type DefectDecision = 'EXCHANGE' | 'REFUND' | 'CLAIM' | 'WRITEOFF';

export interface DefectAct {
  document_id: string;
  return_id: string | null;
  discrepancy_id: string | null;
  product_id: string;
  qty: string;
  reason: string;
  decision: DefectDecision | null;
  checked_by: string | null;
  products: { sku: string; name: string };
  documents: { doc_number: string; status: string; business_date: string };
}

export interface WriteOff {
  document_id: string;
  total_cost: string;
  write_off_items: {
    id: string;
    layer_id: string;
    warehouse_id: string;
    qty: string;
    unit_cost: string;
  }[];
  documents: { doc_number: string; status: string; business_date: string };
}

/** §38's figure: what the defect cost once the scrap money is counted. */
export interface DefectResult {
  written_off_cost: string;
  scrap_income: string;
  net_loss: string;
}
