-- Up Migration
-- Phase 18.2: reminders 24 hours and 2 hours before the show.

-- The customer can turn them off (account page); other emails still go out.
ALTER TABLE users ADD COLUMN event_reminders boolean NOT NULL DEFAULT true;

-- One row per reminder sent: written in the same statement that picks the
-- orders, so a job run twice (or two workers) never sends one twice.
CREATE TABLE order_reminders (
  order_id  uuid         NOT NULL,
  kind      varchar(10)  NOT NULL,
  sent_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT order_reminders_pkey PRIMARY KEY (order_id, kind),
  CONSTRAINT order_reminders_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT chk_order_reminders_kind CHECK (kind IN ('24H', '2H'))
);

-- Down Migration

DROP TABLE IF EXISTS order_reminders;
ALTER TABLE users DROP COLUMN IF EXISTS event_reminders;
