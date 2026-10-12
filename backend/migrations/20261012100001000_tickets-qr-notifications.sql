-- Up Migration
-- Phase 9: ticket QR versions and unread notifications. See docs/phase-9-queue-design.md.

-- The QR code is signed over (ticket id, qr_version). Re-issuing a QR (TKT-03)
-- bumps the version, which invalidates every copy of the old code.
ALTER TABLE tickets
  ADD COLUMN qr_version int NOT NULL DEFAULT 1,
  ADD CONSTRAINT chk_tickets_qr_version CHECK (qr_version >= 1);

-- "How many unread notifications do I have?" on every app start.
CREATE INDEX idx_notifications_user_id_unread ON notifications (user_id) WHERE read_at IS NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_notifications_user_id_unread;
ALTER TABLE tickets
  DROP CONSTRAINT IF EXISTS chk_tickets_qr_version,
  DROP COLUMN IF EXISTS qr_version;
