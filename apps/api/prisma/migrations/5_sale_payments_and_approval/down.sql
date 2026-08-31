-- ============================================================================
-- DOWN: 5_sale_payments_and_approval
--
-- sale_payment_lines өчкөндө сатуулардын кайсы каналдан төлөнгөнү жоголот;
-- account_movements өз ордунда калат, ошондуктан касса баланстары тийбейт.
-- ============================================================================

DROP TABLE IF EXISTS sale_payment_lines CASCADE;

ALTER TABLE sales
  DROP COLUMN IF EXISTS approval_decided_at,
  DROP COLUMN IF EXISTS approval_requested_at,
  DROP COLUMN IF EXISTS approval_status;

DROP TYPE IF EXISTS approval_status;

DELETE FROM _prisma_migrations WHERE migration_name = '5_sale_payments_and_approval';
