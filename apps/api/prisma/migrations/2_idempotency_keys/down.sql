-- ============================================================================
-- DOWN: 2_idempotency_keys
--
-- Removes duplicate-request protection. Any in-flight client retry after this
-- runs will execute a second time.
-- ============================================================================

DROP TABLE IF EXISTS idempotency_keys CASCADE;

DELETE FROM _prisma_migrations WHERE migration_name = '2_idempotency_keys';
