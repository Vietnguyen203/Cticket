-- Up Migration
-- Phase 17: payments through VNPay (sandbox), refunds through its API.

-- One VNPay attempt = one payments row:
--   provider_ref          vnp_TxnRef, our unique reference sent to VNPay
--   provider_create_date  vnp_CreateDate as sent (yyyyMMddHHmmss, GMT+7):
--                         querydr and refund must repeat it exactly
--   provider_response_code the reason VNPay gave (24 cancelled, 51 no funds…)
--   provider_data         the verified parameters VNPay sent (signature removed),
--                         kept to answer a dispute
ALTER TABLE payments
  ADD COLUMN provider_ref varchar(100),
  ADD COLUMN provider_create_date char(14),
  ADD COLUMN provider_response_code varchar(10),
  ADD COLUMN provider_data jsonb;
CREATE UNIQUE INDEX uq_payments_provider_ref ON payments (provider, provider_ref) WHERE provider_ref IS NOT NULL;
-- The reconciliation job looks for attempts still waiting for VNPay.
CREATE INDEX idx_payments_pending ON payments (created_at) WHERE status = 'PENDING';

-- Refunds through VNPay run in a queue: PENDING until VNPay accepts, FAILED
-- (with the reason) when it refuses or never answers; an admin can retry.
ALTER TABLE refunds
  ADD COLUMN attempts int NOT NULL DEFAULT 0,
  ADD COLUMN failure_message text,
  ADD COLUMN requested_by varchar(255),
  ADD COLUMN provider_data jsonb,
  ADD CONSTRAINT chk_refunds_attempts CHECK (attempts >= 0);

-- Down Migration

ALTER TABLE refunds
  DROP CONSTRAINT IF EXISTS chk_refunds_attempts,
  DROP COLUMN IF EXISTS provider_data,
  DROP COLUMN IF EXISTS requested_by,
  DROP COLUMN IF EXISTS failure_message,
  DROP COLUMN IF EXISTS attempts;
DROP INDEX IF EXISTS idx_payments_pending;
DROP INDEX IF EXISTS uq_payments_provider_ref;
ALTER TABLE payments
  DROP COLUMN IF EXISTS provider_data,
  DROP COLUMN IF EXISTS provider_response_code,
  DROP COLUMN IF EXISTS provider_create_date,
  DROP COLUMN IF EXISTS provider_ref;
