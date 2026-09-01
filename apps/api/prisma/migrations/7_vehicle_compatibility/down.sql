-- ============================================================================
-- DOWN: 7_vehicle_compatibility
--
-- Байланыштар өчкөндө products.compatibility_notes ордунда калат, ошондуктан
-- кайсы тетик кайсы моделге туура келери жөнүндөгү эркин жазуу жоголбойт.
-- Эч кандай акча же складдык маалымат тийбейт.
-- ============================================================================

DROP TABLE IF EXISTS product_compatibility CASCADE;
DROP TABLE IF EXISTS vehicle_models CASCADE;
DROP TYPE IF EXISTS compatibility_status;

DELETE FROM _prisma_migrations WHERE migration_name = '7_vehicle_compatibility';
