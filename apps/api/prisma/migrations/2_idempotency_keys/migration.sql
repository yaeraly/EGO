-- ============================================================================
-- Idempotency keys (Connectivity: "Маанилүү write/confirm операциялары
-- техникалык жактан duplicate request'тен корголууга тийиш").
--
-- EGOMOT is online-only, so a dropped connection during a confirm leaves the
-- client unsure whether the document posted. Retrying blindly would create a
-- second sale, payment or movement. A key makes the retry return the first
-- response instead of running again.
--
-- The key is scoped to the user, so two people cannot collide on a
-- client-generated value.
-- ============================================================================

CREATE TABLE idempotency_keys (
  key           TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(id),
  endpoint      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  status_code   INT,
  response_body JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  PRIMARY KEY (key, user_id)
);

CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);
