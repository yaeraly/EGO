-- Кайтаруу: сүрөттөр base'ден чыгарылат (кайтарылгыс — байт маалымат
-- JSONB'ге кайра батпайт), products.images кайра кошулат.
ALTER TABLE products ADD COLUMN images JSONB NOT NULL DEFAULT '[]';
DROP TABLE product_images;
