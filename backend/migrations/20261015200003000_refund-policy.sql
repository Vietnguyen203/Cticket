-- Up Migration
-- Phase 18.3: the refund policy an organizer picks for an event; customers
-- cancel paid orders themselves under it (partial refunds).

-- NONE (no self-cancelling, the default and the rule of every older event),
-- STANDARD, FLEXIBLE: fixed tiers in code (src/modules/payments/refund-policy.js).
ALTER TABLE events
  ADD COLUMN refund_policy varchar(20) NOT NULL DEFAULT 'NONE',
  ADD CONSTRAINT chk_events_refund_policy CHECK (refund_policy IN ('NONE', 'STANDARD', 'FLEXIBLE'));

-- Down Migration

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS chk_events_refund_policy,
  DROP COLUMN IF EXISTS refund_policy;
