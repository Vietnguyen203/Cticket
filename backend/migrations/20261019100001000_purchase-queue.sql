-- Up Migration
-- Phase 21: purchase queue ("waiting room"). With the queue on, at most
-- queue_capacity people buy tickets of the event at the same time; the others
-- wait their turn. The queue itself lives in Redis (src/modules/purchase-queue).
-- See docs/phase-21-queue-design.md.

ALTER TABLE events
  ADD COLUMN queue_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN queue_capacity int NOT NULL DEFAULT 100,
  ADD COLUMN queue_session_minutes int NOT NULL DEFAULT 10,
  ADD CONSTRAINT chk_events_queue_capacity CHECK (queue_capacity BETWEEN 1 AND 10000),
  ADD CONSTRAINT chk_events_queue_session CHECK (queue_session_minutes BETWEEN 5 AND 30);

-- The admission job looks for the published events with the queue on.
CREATE INDEX idx_events_queue_enabled ON events (id) WHERE queue_enabled;

-- Down Migration

DROP INDEX IF EXISTS idx_events_queue_enabled;
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS chk_events_queue_session,
  DROP CONSTRAINT IF EXISTS chk_events_queue_capacity,
  DROP COLUMN IF EXISTS queue_session_minutes,
  DROP COLUMN IF EXISTS queue_capacity,
  DROP COLUMN IF EXISTS queue_enabled;
