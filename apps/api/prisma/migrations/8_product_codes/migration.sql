-- ============================================================================
-- Товардын коддору автоматтык түзүлөт + Кытайдагы баа
--
-- 1. SKU менен barcode'ду колдонуучу ойлоп таппайт. §12-Б.9.1 «ар бир
--    активдүү Product уникалдуу SKU Code'го ээ» дейт, бирок форматты
--    аныктабайт — кол менен терилген код эртеби-кечпи кайталанат же жаңылыш
--    терилет. Эми сервер берет: PREFIX-NNNNN.
--
--    PREFIX — категориянын коду (болсо), болбосо 'PRD'. Ошондуктан «MOT-00042»
--    прилавкада эмне экенин айтып турат. Категориянын коду өзгөрсө мурдагы
--    SKU өзгөрбөйт — код берилген учурдагы абалды чагылдырат.
--
-- 2. barcode ушул убакка чейин уникалдуу эмес эле. Автоматтык түзүлгөндөн
--    кийин ал уникалдуу болушу керек, антпесе сканер эки товарды тапмак.
--    Толтурулгандары гана текшерилет (partial index): эски товарлардын
--    barcode'у жок болушу мүмкүн.
--
-- 3. purchase_price_cny — товар түзүлгөндөгү Кытайдагы баа. §12-Б.5 «акыркы
--    сатып алуу баасын» сактайт, бирок ал биринчи заказдан кийин гана пайда
--    болот; жаңы товарга баа керек — сатып алуу жардамчысы (§33) заказдын
--    наркын ошону менен эсептейт. Чыныгы заказ болгондон кийин акыркы
--    факт баа үстөмдүк кылат.
-- ============================================================================

ALTER TABLE product_categories
  ADD COLUMN code TEXT;
CREATE UNIQUE INDEX idx_categories_code ON product_categories(code)
  WHERE code IS NOT NULL;

ALTER TABLE products
  ADD COLUMN purchase_price_cny NUMERIC(14,2)
    CHECK (purchase_price_cny IS NULL OR purchase_price_cny >= 0);

CREATE UNIQUE INDEX idx_products_barcode ON products(barcode)
  WHERE barcode IS NOT NULL;

-- SKU эсептегичи: документ номерлөө менен бирдей ыкма — SELECT ... FOR UPDATE.
CREATE TABLE product_sequences (
  prefix      TEXT PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
);
