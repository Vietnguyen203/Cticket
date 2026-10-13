-- Up Migration
-- Phase 12.4: sales reports filter sold orders by payment day and refunds by
-- refund day (docs/phase-12.4-reports-design.md, section 3.5).

CREATE INDEX idx_orders_sold_paid_at ON orders (paid_at) WHERE status IN ('PAID', 'COMPLETED');
CREATE INDEX idx_refunds_completed_at ON refunds (completed_at) WHERE status = 'SUCCESS';

-- Down Migration

DROP INDEX IF EXISTS idx_refunds_completed_at;
DROP INDEX IF EXISTS idx_orders_sold_paid_at;
