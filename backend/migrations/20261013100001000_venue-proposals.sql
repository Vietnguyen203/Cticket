-- Up Migration
-- Phase 12.2: organizers propose new venues. See docs/phase-12-admin-web-design.md (section 8).
--
-- A proposed venue is PENDING: only the organizer who proposed it (and admins)
-- see it, and only that organizer's DRAFT events may use it. Approving an event
-- activates the PENDING venues of its schedules in the same transaction; an
-- admin may also approve (ACTIVE) or reject (INACTIVE) it on its own.
ALTER TYPE venue_status ADD VALUE IF NOT EXISTS 'PENDING';

ALTER TABLE venues
  ADD COLUMN created_by_organizer_id uuid
    CONSTRAINT venues_created_by_organizer_id_fkey REFERENCES organizers (id) ON DELETE SET NULL;
CREATE INDEX idx_venues_created_by_organizer_id ON venues (created_by_organizer_id)
  WHERE created_by_organizer_id IS NOT NULL;

INSERT INTO permissions (code, name) VALUES ('venue:propose', 'Propose venues for own events');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'venue:propose'
WHERE r.code IN ('ORGANIZER', 'ADMIN');

-- Down Migration
-- PostgreSQL cannot drop an enum value: 'PENDING' stays in venue_status.
UPDATE venues SET status = 'INACTIVE' WHERE status = 'PENDING';
DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'venue:propose');
DELETE FROM permissions WHERE code = 'venue:propose';
DROP INDEX IF EXISTS idx_venues_created_by_organizer_id;
ALTER TABLE venues DROP COLUMN IF EXISTS created_by_organizer_id;
