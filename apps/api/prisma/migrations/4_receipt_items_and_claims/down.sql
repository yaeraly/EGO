-- ============================================================================
-- DOWN: 4_receipt_items_and_claims
--
-- receipt_items өчкөндө тастыкталбаган приходдордун фактілик сандары жоголот;
-- тастыкталгандары lot_items'те калат.
-- ============================================================================

DROP TABLE IF EXISTS receipt_expense_manual_allocations CASCADE;
DROP TABLE IF EXISTS receipt_items CASCADE;

ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_check1;
ALTER TABLE claims DROP COLUMN IF EXISTS writeoff_reason;

ALTER TABLE lot_items DROP CONSTRAINT IF EXISTS lot_items_damaged_qty_check1;
ALTER TABLE lot_items DROP COLUMN IF EXISTS damaged_qty;

DELETE FROM _prisma_migrations WHERE migration_name = '4_receipt_items_and_claims';
