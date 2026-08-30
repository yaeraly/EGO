-- ============================================================================
-- DOWN: 0_init
--
-- Reverses db/egomot_schema.sql in full: every table, then every enum type.
-- CASCADE settles the foreign keys, so the order below needs no dependency
-- sort. IF EXISTS keeps the script re-runnable against a partial rollback.
--
-- This destroys all data. It exists so the baseline is reversible in a test
-- or staging database (CLAUDE.md: "Миграциялар кайтарылгыс болбосун"), not so
-- it can be run against production.
-- ============================================================================

DROP TABLE IF EXISTS account_movements, account_transfers, advance_refund_lines, advances, audit_log, bonus_payments, bonuses, business_days, business_months, capital_docs, cargo_companies, cargo_ledger, cargo_payments, claim_compensations, claims, corrections, credit_overrides, currency_exchanges, currency_layer_consumptions, currency_layers, customer_payment_lines, customer_payments, customers, daily_cash_handovers, defect_acts, discrepancies, doc_sequences, documents, expense_allocations, expense_categories, expenses, fifo_layers, handover_acts, handover_checked_items, inventories, inventory_lines, investors, layer_stock, lot_items, lots, other_income, payment_accounts, payment_allocations, product_aliases, product_categories, products, purchase_items, purchase_status_history, purchases, receipt_expenses, receipts, refund_lines, reservation_items, reservations, return_items, returns, salary_payments, sale_items, sale_layer_allocations, sales, security_log, settings, stock_movements, supplier_ledger, supplier_payments, suppliers, users, warehouse_transfer_items, warehouse_transfers, warehouses, withdrawal_docs, write_off_items, write_offs CASCADE;

DROP TYPE IF EXISTS account_type, advance_status, bonus_status, capital_source, claim_status, claim_type, currency_code, customer_category, customer_type, day_status, debt_status, discrepancy_status, discrepancy_type, doc_status, doc_type, expense_alloc_basis, fifo_layer_source, month_status, purchase_status, rate_source, receipt_expense_type, receipt_status, reservation_status, return_condition, sale_status, stock_movement_type, transfer_status, user_role, user_status, warehouse_type, withdrawal_type CASCADE;

-- Prisma's ledger survives the drop above (it is not part of the schema), so
-- the entry has to be cleared by hand or `migrate deploy` will think the
-- baseline is still applied and refuse to re-create it.
DELETE FROM _prisma_migrations WHERE migration_name = '0_init';
