-- Up Migration

-- ---------------------------------------------------------------------------
-- 1. Accent-insensitive search: "son tung" finds "Sơn Tùng", "ha noi" finds "Hà Nội".
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() is only STABLE (its result depends on a configurable dictionary),
-- and PostgreSQL only allows IMMUTABLE functions in an index. This wrapper pins
-- the dictionary explicitly, which makes the IMMUTABLE promise true.
CREATE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- Queries must use EXACTLY this expression to hit the index:
--   immutable_unaccent(lower(title)) LIKE '%keyword%'
DROP INDEX idx_events_title_trgm;
CREATE INDEX idx_events_title_search ON events USING gin (immutable_unaccent(lower(title)) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 2. A venue cannot host two schedules at overlapping times.
-- ---------------------------------------------------------------------------
-- btree_gist lets a GiST index compare plain values (venue_id =) alongside
-- ranges (&& = "overlaps"). An EXCLUSION constraint is like UNIQUE, but for
-- "no two rows may overlap": the database rejects the second schedule even
-- when two organizers insert at the same instant. '[)' = end time exclusive,
-- so a show ending at 21:00 and another starting at 21:00 do not conflict.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE event_schedules
  ADD CONSTRAINT excl_event_schedules_venue_overlap
  EXCLUDE USING gist (venue_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
  WHERE (status <> 'CANCELLED');

-- ---------------------------------------------------------------------------
-- 3. Deleting a category that events still use must FAIL, not silently
--    remove it from those events (it was ON DELETE CASCADE).
-- ---------------------------------------------------------------------------
ALTER TABLE event_categories DROP CONSTRAINT event_categories_category_id_fkey;
ALTER TABLE event_categories
  ADD CONSTRAINT event_categories_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT;

-- Down Migration

ALTER TABLE event_categories DROP CONSTRAINT event_categories_category_id_fkey;
ALTER TABLE event_categories
  ADD CONSTRAINT event_categories_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE;

ALTER TABLE event_schedules DROP CONSTRAINT IF EXISTS excl_event_schedules_venue_overlap;
DROP EXTENSION IF EXISTS btree_gist;

DROP INDEX IF EXISTS idx_events_title_search;
CREATE INDEX idx_events_title_trgm ON events USING gin (title gin_trgm_ops);
DROP FUNCTION IF EXISTS immutable_unaccent(text);
DROP EXTENSION IF EXISTS unaccent;
