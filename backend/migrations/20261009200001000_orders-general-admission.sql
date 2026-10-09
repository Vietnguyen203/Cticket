-- Up Migration
-- Phase 5: orders can hold general-admission tickets (a quantity, no seat),
-- and tickets can be issued N per GA order line. See docs/phase-5-booking-design.md.

-- ---------------------------------------------------------------------------
-- 1. Order items: a RESERVED line is exactly one seat; a GA line is a quantity
--    of one ticket type without a seat.
-- ---------------------------------------------------------------------------
ALTER TABLE order_items
  ALTER COLUMN schedule_seat_id DROP NOT NULL,
  ALTER COLUMN seat_id DROP NOT NULL,
  ALTER COLUMN seat_label DROP NOT NULL,
  ALTER COLUMN ticket_type_id SET NOT NULL,
  -- The seat columns are all set (RESERVED, quantity 1) or all empty (GA).
  -- Without this, MATCH SIMPLE would skip the composite seat FK for a row with
  -- only some of them set.
  ADD CONSTRAINT chk_order_items_kind CHECK (
       (schedule_seat_id IS NOT NULL AND seat_id IS NOT NULL AND seat_label IS NOT NULL AND quantity = 1)
    OR (schedule_seat_id IS NULL AND seat_id IS NULL)
  );

-- The ticket type belongs to the order's schedule (replaces the plain FK).
ALTER TABLE order_items DROP CONSTRAINT order_items_ticket_type_id_fkey;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_ticket_type_fkey
    FOREIGN KEY (ticket_type_id, schedule_id) REFERENCES ticket_types (id, schedule_id);
CREATE INDEX idx_order_items_ticket_type_id ON order_items (ticket_type_id);

-- One GA line per ticket type per order (quantities are summed, never split).
CREATE UNIQUE INDEX uq_order_items_ga_line ON order_items (order_id, ticket_type_id)
  WHERE schedule_seat_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Tickets: a GA line of quantity N issues tickets 1..N. Issuing stays
--    idempotent through UNIQUE (order_item_id, admission_no).
--    uq_tickets_live_seat is unchanged: NULL seats are not compared.
-- ---------------------------------------------------------------------------
ALTER TABLE tickets
  ALTER COLUMN schedule_seat_id DROP NOT NULL,
  ADD COLUMN admission_no int NOT NULL DEFAULT 1,
  ADD CONSTRAINT chk_tickets_admission_no CHECK (admission_no >= 1),
  DROP CONSTRAINT tickets_order_item_id_key,
  ADD CONSTRAINT tickets_order_item_id_admission_no_key UNIQUE (order_item_id, admission_no);

-- ---------------------------------------------------------------------------
-- 3. Orders: why an order was cancelled; cancelled_at set exactly when CANCELLED.
-- ---------------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN cancel_reason text,
  ADD CONSTRAINT chk_orders_cancelled CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL));

-- Down Migration

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS chk_orders_cancelled,
  DROP COLUMN IF EXISTS cancel_reason;

-- Fails if a GA order line has tickets; acceptable for a development rollback.
ALTER TABLE tickets
  DROP CONSTRAINT IF EXISTS tickets_order_item_id_admission_no_key,
  DROP CONSTRAINT IF EXISTS chk_tickets_admission_no,
  DROP COLUMN IF EXISTS admission_no,
  ADD CONSTRAINT tickets_order_item_id_key UNIQUE (order_item_id);
ALTER TABLE tickets ALTER COLUMN schedule_seat_id SET NOT NULL;

DROP INDEX IF EXISTS uq_order_items_ga_line;
DROP INDEX IF EXISTS idx_order_items_ticket_type_id;
ALTER TABLE order_items
  DROP CONSTRAINT IF EXISTS order_items_ticket_type_fkey,
  DROP CONSTRAINT IF EXISTS chk_order_items_kind,
  ADD CONSTRAINT order_items_ticket_type_id_fkey FOREIGN KEY (ticket_type_id) REFERENCES ticket_types (id);
-- Fails if GA order lines exist; acceptable for a development rollback.
ALTER TABLE order_items
  ALTER COLUMN ticket_type_id DROP NOT NULL,
  ALTER COLUMN seat_label SET NOT NULL,
  ALTER COLUMN seat_id SET NOT NULL,
  ALTER COLUMN schedule_seat_id SET NOT NULL;
