-- ============================================================================
-- DOWN: 3_purchases_and_notifications
--
-- purchase_id өчкөндө Purchase боюнча төлөм статусу эсептелбей калат;
-- эскертүүлөрдүн тарыхы да жоголот.
-- ============================================================================

DROP TABLE IF EXISTS notifications CASCADE;

DROP INDEX IF EXISTS idx_spy_purchase;
ALTER TABLE supplier_payments DROP COLUMN IF EXISTS purchase_id;

DELETE FROM _prisma_migrations WHERE migration_name = '3_purchases_and_notifications';
