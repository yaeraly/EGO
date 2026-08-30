-- ============================================================================
-- Module 2 — сатып алуу жана контрагент төлөмдөрү
--
-- Эки кошумча:
--
-- 1. supplier_payments.purchase_id — SPY кайсы Purchase'ка тиешелүү экени.
--    §4.2 ар бир Purchase боюнча төлөм статусун талап кылат (Төлөнө элек /
--    Жарым-жартылай / Толук), ал ошол Purchase'ка байланышкан SPY
--    суммаларынан эсептелет. Optional: жалпы карызга да төлөсө болот.
--
-- 2. notifications — §39 эскертүүлөрү үчүн ички таблица.
-- ============================================================================

ALTER TABLE supplier_payments
  ADD COLUMN purchase_id UUID REFERENCES purchases(document_id);

CREATE INDEX idx_spy_purchase ON supplier_payments(purchase_id);

CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  payload     JSONB,
  dedupe_key  TEXT NOT NULL,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX idx_notifications_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
