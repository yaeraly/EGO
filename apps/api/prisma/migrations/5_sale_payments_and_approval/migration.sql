-- ============================================================================
-- Module 4 — сатуу, төлөм, карыз
--
-- Эки кошумча, экөө тең билим базанын иш агымы талап кылган, бирок эталон
-- схемада орду жок болгон нерсе.
--
-- 1. sale_payment_lines — §15 бир сатууну бир нече канал менен төлөөгө
--    уруксат берет, §15.2 сдачаны Cash эсебинен гана берүүнү талап кылат.
--    customer_payment_lines кийинки PAY документине тиешелүү; сатуунун өз
--    учурундагы акчасы турар жер керек.
--
-- 2. sales.approval_status — §13.5 боюнча кызматкердин лимитинен ашкан
--    скидка OWNER бекиткенге чейин сатуу тастыкталбайт. «Ким бекитти»
--    (owner_approval_user) мурдатан бар, бирок «бекитилдиби, суралдыбы,
--    четке кагылдыбы» дегенди сактай турган талаа жок эле.
-- ============================================================================

CREATE TYPE approval_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE sale_payment_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     UUID NOT NULL REFERENCES sales(document_id),
  account_id  UUID NOT NULL REFERENCES payment_accounts(id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  cash_given  NUMERIC(14,2),
  change_given NUMERIC(14,2),
  CONSTRAINT sale_payment_lines_change_check
    CHECK (change_given IS NULL OR (cash_given IS NOT NULL AND change_given >= 0)),
  CONSTRAINT sale_payment_lines_cash_check
    CHECK (cash_given IS NULL OR cash_given >= amount)
);
CREATE INDEX idx_sale_payment_lines_sale ON sale_payment_lines(sale_id);

ALTER TABLE sales
  ADD COLUMN approval_status approval_status,
  ADD COLUMN approval_requested_at TIMESTAMPTZ,
  ADD COLUMN approval_decided_at   TIMESTAMPTZ;
