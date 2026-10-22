-- Up Migration
-- The number of people a show is planned for ("Tổng số người tham dự"). The
-- organizer splits it into seated tiers (seats taken from the venue, front
-- rows first) and standing tiers; together they must not exceed it
-- (ticket-types.service.js). NULL: not set (older shows).

ALTER TABLE event_schedules
  ADD COLUMN capacity int,
  ADD CONSTRAINT chk_event_schedules_capacity CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 1000000);

-- Down Migration

ALTER TABLE event_schedules
  DROP CONSTRAINT IF EXISTS chk_event_schedules_capacity,
  DROP COLUMN IF EXISTS capacity;
