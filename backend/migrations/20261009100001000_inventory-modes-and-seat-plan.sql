-- Up Migration
-- Phase 4: venue layout kinds, ticket types for reserved seating AND general
-- admission, the editable seat plan (configuration) and the generated
-- schedule inventory. See docs/phase-4-inventory-design.md.

-- ---------------------------------------------------------------------------
-- 1. Zone kinds: SEATED zones contain physical seats; STANDING zones have a
--    capacity only (no seat rows at all).
-- ---------------------------------------------------------------------------
CREATE TYPE zone_kind AS ENUM ('SEATED', 'STANDING');

ALTER TABLE venue_zones
  ADD COLUMN kind zone_kind NOT NULL DEFAULT 'SEATED',
  ADD CONSTRAINT chk_venue_zones_standing_capacity CHECK (kind <> 'STANDING' OR capacity IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2. Ticket types: RESERVED (each seat assigned through the seat plan) or
--    GENERAL_ADMISSION (a capacity, no seats needed).
-- ---------------------------------------------------------------------------
CREATE TYPE inventory_mode AS ENUM ('RESERVED', 'GENERAL_ADMISSION');

ALTER TABLE ticket_types
  ALTER COLUMN venue_zone_id DROP NOT NULL,          -- GA may have no zone at all
  ADD COLUMN inventory_mode inventory_mode NOT NULL DEFAULT 'RESERVED',
  ADD COLUMN capacity int,
  ADD COLUMN max_per_order int NOT NULL DEFAULT 10,
  ADD COLUMN sort_order int NOT NULL DEFAULT 0,
  ADD COLUMN description text,
  -- GA has a capacity; RESERVED gets its size from the seat plan instead.
  ADD CONSTRAINT chk_ticket_types_mode_capacity
    CHECK ((inventory_mode = 'GENERAL_ADMISSION') = (capacity IS NOT NULL)),
  ADD CONSTRAINT chk_ticket_types_capacity CHECK (capacity IS NULL OR capacity > 0),
  ADD CONSTRAINT chk_ticket_types_max_per_order CHECK (max_per_order BETWEEN 1 AND 50),
  -- Target of composite FKs: "this ticket type belongs to THIS schedule".
  ADD CONSTRAINT ticket_types_id_schedule_id_key UNIQUE (id, schedule_id);

-- Ticket types are configuration of a schedule: deleting a DRAFT schedule
-- removes them. (After publishing, schedules are cancelled, never deleted.)
ALTER TABLE ticket_types DROP CONSTRAINT ticket_types_schedule_id_fkey;
ALTER TABLE ticket_types
  ADD CONSTRAINT ticket_types_schedule_id_fkey
  FOREIGN KEY (schedule_id) REFERENCES event_schedules (id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Seat plan (configuration, editable while the event is DRAFT):
--    which physical seat is sold under which ticket type for a schedule.
-- ---------------------------------------------------------------------------
CREATE TABLE schedule_seat_plan (
  schedule_id     uuid NOT NULL,
  seat_id         uuid NOT NULL,
  ticket_type_id  uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- One seat → exactly one ticket type per schedule.
  CONSTRAINT schedule_seat_plan_pkey PRIMARY KEY (schedule_id, seat_id),
  CONSTRAINT schedule_seat_plan_schedule_fkey
    FOREIGN KEY (schedule_id) REFERENCES event_schedules (id) ON DELETE CASCADE,
  CONSTRAINT schedule_seat_plan_seat_fkey FOREIGN KEY (seat_id) REFERENCES seats (id),
  -- The ticket type must be one of THIS schedule's ticket types.
  CONSTRAINT schedule_seat_plan_ticket_type_fkey
    FOREIGN KEY (ticket_type_id, schedule_id) REFERENCES ticket_types (id, schedule_id) ON DELETE CASCADE
);
CREATE INDEX idx_schedule_seat_plan_ticket_type_id ON schedule_seat_plan (ticket_type_id);
CREATE INDEX idx_schedule_seat_plan_seat_id ON schedule_seat_plan (seat_id);

-- ---------------------------------------------------------------------------
-- 4. Reserved inventory rows now record their ticket type.
--    (No inventory exists yet: rows are only generated when an event is approved.)
-- ---------------------------------------------------------------------------
ALTER TABLE schedule_seats
  ADD COLUMN ticket_type_id uuid NOT NULL,
  ADD CONSTRAINT schedule_seats_ticket_type_fkey
    FOREIGN KEY (ticket_type_id, schedule_id) REFERENCES ticket_types (id, schedule_id);
-- Availability counts per ticket type.
CREATE INDEX idx_schedule_seats_schedule_ticket_type ON schedule_seats (schedule_id, ticket_type_id, status);

-- ---------------------------------------------------------------------------
-- 5. General admission inventory: counters, no seat rows.
-- ---------------------------------------------------------------------------
CREATE TABLE ga_inventory (
  ticket_type_id    uuid        NOT NULL,
  schedule_id       uuid        NOT NULL,
  capacity          int         NOT NULL,
  held_quantity     int         NOT NULL DEFAULT 0,
  sold_quantity     int         NOT NULL DEFAULT 0,
  blocked_quantity  int         NOT NULL DEFAULT 0,
  version           int         NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_inventory_pkey PRIMARY KEY (ticket_type_id),
  CONSTRAINT ga_inventory_ticket_type_fkey
    FOREIGN KEY (ticket_type_id, schedule_id) REFERENCES ticket_types (id, schedule_id),
  CONSTRAINT chk_ga_inventory_non_negative
    CHECK (capacity > 0 AND held_quantity >= 0 AND sold_quantity >= 0 AND blocked_quantity >= 0),
  -- The last line of defence against overselling general admission.
  CONSTRAINT chk_ga_inventory_capacity
    CHECK (held_quantity + sold_quantity + blocked_quantity <= capacity)
);
CREATE INDEX idx_ga_inventory_schedule_id ON ga_inventory (schedule_id);
CREATE TRIGGER trg_ga_inventory_version BEFORE UPDATE ON ga_inventory
  FOR EACH ROW EXECUTE FUNCTION bump_version();

-- ---------------------------------------------------------------------------
-- 6. Idempotency marker for inventory generation.
-- ---------------------------------------------------------------------------
ALTER TABLE event_schedules ADD COLUMN inventory_generated_at timestamptz;

-- Down Migration

ALTER TABLE event_schedules DROP COLUMN IF EXISTS inventory_generated_at;
DROP TABLE IF EXISTS ga_inventory;
DROP INDEX IF EXISTS idx_schedule_seats_schedule_ticket_type;
ALTER TABLE schedule_seats
  DROP CONSTRAINT IF EXISTS schedule_seats_ticket_type_fkey,
  DROP COLUMN IF EXISTS ticket_type_id;
DROP TABLE IF EXISTS schedule_seat_plan;

ALTER TABLE ticket_types DROP CONSTRAINT ticket_types_schedule_id_fkey;
ALTER TABLE ticket_types
  ADD CONSTRAINT ticket_types_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES event_schedules (id);
ALTER TABLE ticket_types
  DROP CONSTRAINT IF EXISTS ticket_types_id_schedule_id_key,
  DROP CONSTRAINT IF EXISTS chk_ticket_types_max_per_order,
  DROP CONSTRAINT IF EXISTS chk_ticket_types_capacity,
  DROP CONSTRAINT IF EXISTS chk_ticket_types_mode_capacity,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS sort_order,
  DROP COLUMN IF EXISTS max_per_order,
  DROP COLUMN IF EXISTS capacity,
  DROP COLUMN IF EXISTS inventory_mode;
-- Fails if a GA ticket type without zone exists; acceptable for a development rollback.
ALTER TABLE ticket_types ALTER COLUMN venue_zone_id SET NOT NULL;
DROP TYPE IF EXISTS inventory_mode;

ALTER TABLE venue_zones
  DROP CONSTRAINT IF EXISTS chk_venue_zones_standing_capacity,
  DROP COLUMN IF EXISTS kind;
DROP TYPE IF EXISTS zone_kind;
