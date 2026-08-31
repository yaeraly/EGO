-- ============================================================================
-- Module 3 — приход, landed cost, LOT/FIFO
--
-- Төрт кошумча. Экөө — билим базанын иш агымы талап кылган, бирок эталон
-- схемада орду жок болгон сактагыч; экөө — §-эрежени базанын өзүндө бекитүү.
--
-- 1. receipt_items — §7 приходду DRAFT/READY абалында толтурууну талап кылат
--    (ар бир позиция боюнча фактически кабыл алынган сан), а LOT §18.1 боюнча
--    приход ТАСТЫКТАЛГАНДА гана түзүлөт. Ортодо ал сандар турар жер керек.
--
-- 2. receipt_expense_manual_allocations — §9.6 MANUAL суммалары да LOT жок
--    кезде киргизилет, ошондуктан receipt позициясына байланат.
--
-- 3. lot_items.damaged_qty — §8.4 (v2.1): кабыл алууда брак деп табылган товар
--    өзүнүн landed cost'у менен DEFECT складга кирет. Канчасы брак экени
--    LOT'то сакталат.
--
-- 4. claims.writeoff_reason — §8.5: WRITTEN_OFF OWNER чечими менен жана
--    себеби милдеттүү. CHECK аны базанын деңгээлинде кармайт.
-- ============================================================================

CREATE TABLE receipt_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id   UUID NOT NULL REFERENCES receipts(document_id),
  product_id   UUID NOT NULL REFERENCES products(id),
  position     INT NOT NULL,
  ordered_qty  NUMERIC(12,2) NOT NULL CHECK (ordered_qty >= 0),
  received_qty NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  damaged_qty  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  CHECK (damaged_qty <= received_qty),
  UNIQUE (receipt_id, product_id)
);
CREATE INDEX idx_receipt_items_receipt ON receipt_items(receipt_id, position);

CREATE TABLE receipt_expense_manual_allocations (
  id              BIGSERIAL PRIMARY KEY,
  expense_id      UUID NOT NULL REFERENCES receipt_expenses(id) ON DELETE CASCADE,
  receipt_item_id UUID NOT NULL REFERENCES receipt_items(id) ON DELETE CASCADE,
  amount_kgs      NUMERIC(14,2) NOT NULL CHECK (amount_kgs >= 0),
  UNIQUE (expense_id, receipt_item_id)
);

ALTER TABLE lot_items
  ADD COLUMN damaged_qty NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  ADD CONSTRAINT lot_items_damaged_qty_check1 CHECK (damaged_qty <= received_qty);

ALTER TABLE claims
  ADD COLUMN writeoff_reason TEXT,
  ADD CONSTRAINT claims_check1
    CHECK (cstatus <> 'WRITTEN_OFF' OR writeoff_reason IS NOT NULL);
