-- Up Migration
-- Phase 19: event reviews (the reviews table exists since Phase 1).
-- See docs/phase-19-reviews-design.md.

ALTER TABLE reviews
  -- The organizer's public answer (one per review, editable).
  ADD COLUMN organizer_reply       text,
  ADD COLUMN organizer_replied_at  timestamptz,
  -- Hidden by an admin: why, by whom, when (shown to the author only).
  ADD COLUMN hidden_reason         text,
  ADD COLUMN moderated_by          uuid CONSTRAINT reviews_moderated_by_fkey REFERENCES users (id),
  ADD COLUMN moderated_at          timestamptz,
  ADD CONSTRAINT chk_reviews_comment_length CHECK (comment IS NULL OR char_length(comment) <= 2000),
  ADD CONSTRAINT chk_reviews_reply_length CHECK (organizer_reply IS NULL OR char_length(organizer_reply) <= 1000),
  ADD CONSTRAINT chk_reviews_hidden CHECK (status <> 'HIDDEN' OR hidden_reason IS NOT NULL);
-- The published reviews of an event, newest first.
CREATE INDEX idx_reviews_event_published ON reviews (event_id, created_at DESC) WHERE status = 'PUBLISHED';

-- Count and sum of the PUBLISHED reviews, kept with every change in the same
-- transaction (event row locked first): lists read the average without grouping.
ALTER TABLE events
  ADD COLUMN rating_count int NOT NULL DEFAULT 0,
  ADD COLUMN rating_sum   int NOT NULL DEFAULT 0,
  ADD CONSTRAINT chk_events_rating CHECK (rating_count >= 0 AND rating_sum BETWEEN rating_count AND 5 * rating_count);

-- The "how was the show?" email reuses the reminders' sent-once table.
ALTER TABLE order_reminders DROP CONSTRAINT chk_order_reminders_kind;
ALTER TABLE order_reminders ADD CONSTRAINT chk_order_reminders_kind CHECK (kind IN ('24H', '2H', 'REVIEW'));

-- Admins hide / restore reviews.
INSERT INTO permissions (code, name) VALUES ('review:manage', 'Hide and restore reviews');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'review:manage' WHERE r.code = 'ADMIN';

-- Down Migration

DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'review:manage');
DELETE FROM permissions WHERE code = 'review:manage';
DELETE FROM order_reminders WHERE kind = 'REVIEW';
ALTER TABLE order_reminders DROP CONSTRAINT chk_order_reminders_kind;
ALTER TABLE order_reminders ADD CONSTRAINT chk_order_reminders_kind CHECK (kind IN ('24H', '2H'));
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS chk_events_rating,
  DROP COLUMN IF EXISTS rating_sum,
  DROP COLUMN IF EXISTS rating_count;
DROP INDEX IF EXISTS idx_reviews_event_published;
ALTER TABLE reviews
  DROP CONSTRAINT IF EXISTS chk_reviews_hidden,
  DROP CONSTRAINT IF EXISTS chk_reviews_reply_length,
  DROP CONSTRAINT IF EXISTS chk_reviews_comment_length,
  DROP COLUMN IF EXISTS moderated_at,
  DROP COLUMN IF EXISTS moderated_by,
  DROP COLUMN IF EXISTS hidden_reason,
  DROP COLUMN IF EXISTS organizer_replied_at,
  DROP COLUMN IF EXISTS organizer_reply;
