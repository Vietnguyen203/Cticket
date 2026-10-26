-- Up Migration
-- The terms of sale ("Điều kiện giao dịch chung", the web page /dieu-khoan)
-- the buyer accepted at checkout: which version and when, and the event's
-- refund policy at that moment (a later change by the organizer cannot make
-- the deal worse for this buyer: cancellation.service.js). Kept on the order
-- as the record of the contract's terms. NULL: checked out before this existed.

ALTER TABLE orders
  ADD COLUMN terms_version text,
  ADD COLUMN terms_accepted_at timestamptz,
  ADD COLUMN refund_policy text,
  ADD CONSTRAINT chk_orders_terms CHECK ((terms_version IS NULL) = (terms_accepted_at IS NULL)),
  ADD CONSTRAINT chk_orders_refund_policy CHECK (refund_policy IS NULL OR refund_policy IN ('NONE', 'STANDARD', 'FLEXIBLE'));

-- Down Migration

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS chk_orders_refund_policy,
  DROP CONSTRAINT IF EXISTS chk_orders_terms,
  DROP COLUMN IF EXISTS refund_policy,
  DROP COLUMN IF EXISTS terms_accepted_at,
  DROP COLUMN IF EXISTS terms_version;
