-- ============================================================================
-- Module 21 — структураланган Compatibility (§12-Б.8, Приоритет 3)
--
-- §12-Б.8: «Кийинки фазада (Приоритет 3): структураланган Product ↔ Vehicle
-- Model many-to-many байланышы, VERIFIED/UNVERIFIED статустар жана модель
-- боюнча тетик фильтри киргизилет.»
--
-- MVP'деги products.compatibility_notes текст талаасы ордунда калат: ал
-- издөөгө кирет (§12-Б.9.6) жана бул таблицалар аны алмаштырбайт — эркин
-- жазылган эскертүү менен текшерилген байланыш эки башка нерсе.
--
-- Статус эмне үчүн керек: тетик кайсы моделге туура келерин сатуучу да
-- билет, бирок «билем» менен «текшердим» бирдей эмес. UNVERIFIED — айтылган,
-- VERIFIED — ким жана качан текшергени жазылган.
-- ============================================================================

CREATE TYPE compatibility_status AS ENUM ('UNVERIFIED', 'VERIFIED');

CREATE TABLE vehicle_models (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand      TEXT,                              -- бренд белгисиз болушу мүмкүн
  name       TEXT NOT NULL,
  notes      TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULLS NOT DISTINCT: бренди жок эки бирдей модель түзүлбөшү үчүн.
  CONSTRAINT vehicle_models_brand_name_key
    UNIQUE NULLS NOT DISTINCT (brand, name)
);

CREATE TABLE product_compatibility (
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  model_id    UUID NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
  cstatus     compatibility_status NOT NULL DEFAULT 'UNVERIFIED',
  note        TEXT,
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, model_id),
  -- VERIFIED болсо ким жана качан текшергени сөзсүз жазылат.
  CONSTRAINT product_compatibility_verified_check
    CHECK (cstatus <> 'VERIFIED'
           OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX idx_compatibility_model ON product_compatibility(model_id);
