-- ============================================================================
-- Module 17 — План жана KPI (§24)
--
-- §24 OWNER'ге айлык/мезгилдик план коюуга уруксат берет: жалпы сатуу; жалпы
-- маржа/пайда; жаңы кардарлар. §31 ошол пландын аткарылышын ар бир сатуучу
-- боюнча көрсөтүүнү талап кылат. Эталон схемада планды сактай турган жер жок
-- эле — ушул таблица ошол орун.
--
-- user_id NULL = бүтүндөй бизнестин планы; толтурулса — ошол сатуучунуку.
-- NULLS NOT DISTINCT: бир айга бизнес боюнча эки план болбошу керек, ал эми
-- жөнөкөй UNIQUE NULL'дарды ар башка деп эсептейт (PostgreSQL 15+).
--
-- Ар бир максат өзүнчө NULL боло алат: коюлбаган максат «0%» эмес, «план
-- жок» дегенди билдирет жана отчетто ошондой көрүнөт.
-- ============================================================================

CREATE TABLE sales_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year   INT NOT NULL,
  period_month  INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  user_id       UUID REFERENCES users(id),
  revenue_target NUMERIC(14,2) CHECK (revenue_target IS NULL OR revenue_target >= 0),
  margin_target  NUMERIC(14,2) CHECK (margin_target IS NULL OR margin_target >= 0),
  new_customers_target INT CHECK (new_customers_target IS NULL OR new_customers_target >= 0),
  comment       TEXT,
  created_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sales_plans_period_user_key
    UNIQUE NULLS NOT DISTINCT (period_year, period_month, user_id)
);
CREATE INDEX idx_sales_plans_period ON sales_plans(period_year, period_month);
