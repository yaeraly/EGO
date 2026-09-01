-- ============================================================================
-- DOWN: 8_product_codes
--
-- Түзүлгөн SKU менен barcode товарларда кала берет — алар products
-- таблицасынын өз талаалары. Бул жерден кетээри: эсептегич, уникалдуулук
-- текшерүүсү, категориянын коду жана Кытайдагы баа.
-- ============================================================================

DROP TABLE IF EXISTS product_sequences CASCADE;
DROP INDEX IF EXISTS idx_products_barcode;
ALTER TABLE products DROP COLUMN IF EXISTS purchase_price_cny;
DROP INDEX IF EXISTS idx_categories_code;
ALTER TABLE product_categories DROP COLUMN IF EXISTS code;

DELETE FROM _prisma_migrations WHERE migration_name = '8_product_codes';
