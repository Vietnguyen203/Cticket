-- Up Migration

-- ===========================================================================
-- ORGANIZER / CATEGORY
-- ===========================================================================

-- 1-1 with users: UNIQUE(user_id) means one organizer profile per user.
CREATE TABLE organizers (
  id                 uuid              NOT NULL DEFAULT gen_random_uuid(),
  user_id            uuid              NOT NULL,
  organization_name  varchar(255)      NOT NULL,
  description        text,
  tax_code           varchar(50),
  status             organizer_status  NOT NULL DEFAULT 'PENDING',
  created_at         timestamptz       NOT NULL DEFAULT now(),
  updated_at         timestamptz       NOT NULL DEFAULT now(),
  CONSTRAINT organizers_pkey PRIMARY KEY (id),
  CONSTRAINT organizers_user_id_key UNIQUE (user_id),
  CONSTRAINT organizers_tax_code_key UNIQUE (tax_code),
  CONSTRAINT organizers_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id)
);
CREATE INDEX idx_organizers_status ON organizers (status);
CREATE TRIGGER trg_organizers_updated_at BEFORE UPDATE ON organizers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE categories (
  id           uuid          NOT NULL DEFAULT gen_random_uuid(),
  name         varchar(150)  NOT NULL,
  slug         varchar(180)  NOT NULL,
  description  text,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT categories_pkey PRIMARY KEY (id),
  CONSTRAINT categories_slug_key UNIQUE (slug)
);
CREATE TRIGGER trg_categories_updated_at BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- VENUE / SEATS — the physical layout. Nothing here has a booking status:
-- availability is per schedule (schedule_seats).
-- ===========================================================================

CREATE TABLE venues (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  name          varchar(255)  NOT NULL,
  address_line  varchar(500)  NOT NULL,
  city          varchar(100)  NOT NULL,
  province      varchar(100),
  country       varchar(100)  NOT NULL,
  latitude      decimal(9,6),
  longitude     decimal(9,6),
  capacity      int,
  status        venue_status  NOT NULL DEFAULT 'ACTIVE',
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT venues_pkey PRIMARY KEY (id),
  CONSTRAINT chk_venues_capacity CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT chk_venues_latitude CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_venues_longitude CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX idx_venues_city ON venues (city);
CREATE TRIGGER trg_venues_updated_at BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE venue_zones (
  id          uuid          NOT NULL DEFAULT gen_random_uuid(),
  venue_id    uuid          NOT NULL,
  name        varchar(100)  NOT NULL,
  code        varchar(50)   NOT NULL,
  capacity    int,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT venue_zones_pkey PRIMARY KEY (id),
  CONSTRAINT venue_zones_venue_id_code_key UNIQUE (venue_id, code),
  CONSTRAINT venue_zones_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES venues (id),
  CONSTRAINT chk_venue_zones_capacity CHECK (capacity IS NULL OR capacity > 0)
);
CREATE TRIGGER trg_venue_zones_updated_at BEFORE UPDATE ON venue_zones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE seats (
  id             uuid           NOT NULL DEFAULT gen_random_uuid(),
  venue_zone_id  uuid           NOT NULL,
  row_label      varchar(20),
  seat_number    int,
  seat_code      varchar(50)    NOT NULL,   -- e.g. 'A01'
  seat_type      seat_type      NOT NULL DEFAULT 'STANDARD',
  x              decimal(10,4),             -- seat-map coordinates
  y              decimal(10,4),
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT seats_pkey PRIMARY KEY (id),
  -- Also serves lookups by venue_zone_id (leftmost column of the index).
  CONSTRAINT seats_venue_zone_id_seat_code_key UNIQUE (venue_zone_id, seat_code),
  CONSTRAINT seats_venue_zone_id_fkey FOREIGN KEY (venue_zone_id) REFERENCES venue_zones (id),
  CONSTRAINT chk_seats_number CHECK (seat_number IS NULL OR seat_number > 0)
);
CREATE TRIGGER trg_seats_updated_at BEFORE UPDATE ON seats
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- EVENTS / SCHEDULES
-- ===========================================================================

CREATE TABLE events (
  id               uuid          NOT NULL DEFAULT gen_random_uuid(),
  organizer_id     uuid          NOT NULL,
  title            varchar(255)  NOT NULL,
  slug             varchar(300)  NOT NULL,
  description      text,
  banner_url       text,
  thumbnail_url    text,
  status           event_status  NOT NULL DEFAULT 'DRAFT',
  age_restriction  smallint,
  published_at     timestamptz,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT events_pkey PRIMARY KEY (id),
  CONSTRAINT events_slug_key UNIQUE (slug),
  CONSTRAINT events_organizer_id_fkey FOREIGN KEY (organizer_id) REFERENCES organizers (id),
  CONSTRAINT chk_events_published_at CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL),
  CONSTRAINT chk_events_age CHECK (age_restriction IS NULL OR age_restriction BETWEEN 0 AND 99)
);
CREATE INDEX idx_events_organizer_id ON events (organizer_id);
-- Public list: newest published events.
CREATE INDEX idx_events_status_published_at ON events (status, published_at);
-- Makes `title ILIKE '%keyword%'` use an index instead of a full table scan.
CREATE INDEX idx_events_title_trgm ON events USING gin (title gin_trgm_ops);
CREATE TRIGGER trg_events_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- n-n: events ↔ categories
CREATE TABLE event_categories (
  event_id     uuid  NOT NULL,
  category_id  uuid  NOT NULL,
  CONSTRAINT event_categories_pkey PRIMARY KEY (event_id, category_id),
  CONSTRAINT event_categories_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT event_categories_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE
);
CREATE INDEX idx_event_categories_category_id ON event_categories (category_id);

-- n-n: staff assigned to an event (they can only check in tickets of these events).
CREATE TABLE event_staff (
  event_id     uuid         NOT NULL,
  user_id      uuid         NOT NULL,
  assigned_by  uuid,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT event_staff_pkey PRIMARY KEY (event_id, user_id),
  CONSTRAINT event_staff_event_id_fkey FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT event_staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT event_staff_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX idx_event_staff_user_id ON event_staff (user_id);

CREATE TABLE event_schedules (
  id              uuid             NOT NULL DEFAULT gen_random_uuid(),
  event_id        uuid             NOT NULL,
  venue_id        uuid             NOT NULL,
  start_at        timestamptz      NOT NULL,
  end_at          timestamptz      NOT NULL,
  sales_start_at  timestamptz      NOT NULL,
  sales_end_at    timestamptz      NOT NULL,
  status          schedule_status  NOT NULL DEFAULT 'SCHEDULED',
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT event_schedules_pkey PRIMARY KEY (id),
  -- Target of composite FKs that prove "this row's schedule belongs to this event".
  CONSTRAINT event_schedules_id_event_id_key UNIQUE (id, event_id),
  CONSTRAINT event_schedules_event_id_fkey FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT event_schedules_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES venues (id),
  CONSTRAINT chk_schedules_time CHECK (end_at > start_at),
  CONSTRAINT chk_schedules_sales_window
    CHECK (sales_end_at > sales_start_at AND sales_end_at <= start_at)
);
CREATE INDEX idx_event_schedules_event_id_start_at ON event_schedules (event_id, start_at);
CREATE INDEX idx_event_schedules_venue_id_start_at ON event_schedules (venue_id, start_at);
CREATE INDEX idx_event_schedules_start_at ON event_schedules (start_at);
CREATE TRIGGER trg_event_schedules_updated_at BEFORE UPDATE ON event_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS event_schedules;
DROP TABLE IF EXISTS event_staff;
DROP TABLE IF EXISTS event_categories;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS seats;
DROP TABLE IF EXISTS venue_zones;
DROP TABLE IF EXISTS venues;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS organizers;
