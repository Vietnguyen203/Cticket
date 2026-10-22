-- Up Migration
-- The event's guest artists ("Nghệ sĩ khách mời"), in the order entered:
-- items { artist, time, note } (the web app sends names only; time / note
-- stay optional). Information for buyers only: selling, gates, reminders and
-- refunds follow the schedules' real start times. Validated by the API
-- (events.schemas.js); the database keeps it a short array.

ALTER TABLE events
  ADD COLUMN lineup jsonb NOT NULL DEFAULT '[]',
  ADD CONSTRAINT chk_events_lineup CHECK (jsonb_typeof(lineup) = 'array' AND jsonb_array_length(lineup) <= 50);

-- Down Migration

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS chk_events_lineup,
  DROP COLUMN IF EXISTS lineup;
