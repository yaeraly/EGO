-- §12-Б.1 — товардын сүрөттөрү базанын өзүндө.
--
-- Сүрөттөр дискте эмес, ушул таблицада (BYTEA) сакталат: анда pg_dump
-- аларды кошо алат жана база менен сүрөттөр эч качан бири-биринен ажырап
-- калбайт. Тизме products.images JSONB'де эмес, ушул жерде — иреттөө
-- sort_order боюнча, 0 = негизги сүрөт (§12-Б.1).
CREATE TABLE product_images (                        -- §12-Б.1
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order   INT NOT NULL,                         -- 0 = негизги сүрөт
  content_type TEXT NOT NULL,
  width        INT NOT NULL,
  height       INT NOT NULL,
  byte_size    INT NOT NULL,
  data         BYTEA NOT NULL,
  uploaded_by  UUID NOT NULL REFERENCES users(id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_images_product ON product_images(product_id, sort_order);

-- products.images керексиз калды: сүрөттөрдүн тизмеси эми product_images.
ALTER TABLE products DROP COLUMN images;
