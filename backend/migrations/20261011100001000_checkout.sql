-- Up Migration
-- Phase 8: checkout. See docs/phase-8-payments-design.md.
-- checked_out_at marks the one-time move HELD → PAYMENT_PENDING, which also
-- extended the hold by the payment window.
ALTER TABLE orders ADD COLUMN checked_out_at timestamptz;

-- Down Migration
ALTER TABLE orders DROP COLUMN IF EXISTS checked_out_at;
