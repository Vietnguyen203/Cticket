-- Up Migration
-- Phase 14.2: the admin order search finds the START of an order code
-- ("ETP-2610…"). A plain btree index cannot serve LIKE 'x%' under a non-C
-- collation; text_pattern_ops can (EXPLAIN ANALYZE: a full scan of every
-- order before, an index range scan after).

CREATE INDEX idx_orders_order_code_prefix ON orders (order_code text_pattern_ops);

-- Down Migration

DROP INDEX IF EXISTS idx_orders_order_code_prefix;
