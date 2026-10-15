-- Up Migration
-- Phase 18.4: waiting for a sold-out ticket type. When places free up, the
-- earliest people are offered them, with 30 minutes in which those places are
-- kept for them. See docs/phase-18-customer-features-design.md, section 5.

CREATE TABLE waitlist_entries (
  id                uuid         NOT NULL DEFAULT gen_random_uuid(),
  user_id           uuid         NOT NULL,
  schedule_id       uuid         NOT NULL,
  ticket_type_id    uuid         NOT NULL,
  quantity          int          NOT NULL,
  -- WAITING → OFFERED (places kept until offer_expires_at) → BOOKED / EXPIRED;
  -- CANCELLED (left the list), CLOSED (the show stopped selling).
  status            varchar(20)  NOT NULL DEFAULT 'WAITING',
  offered_at        timestamptz,
  offer_expires_at  timestamptz,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_entries_pkey PRIMARY KEY (id),
  CONSTRAINT waitlist_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT waitlist_entries_ticket_type_fkey
    FOREIGN KEY (ticket_type_id, schedule_id) REFERENCES ticket_types (id, schedule_id),
  CONSTRAINT chk_waitlist_quantity CHECK (quantity > 0),
  CONSTRAINT chk_waitlist_status CHECK (status IN ('WAITING', 'OFFERED', 'BOOKED', 'EXPIRED', 'CANCELLED', 'CLOSED')),
  CONSTRAINT chk_waitlist_offer CHECK (status <> 'OFFERED' OR (offered_at IS NOT NULL AND offer_expires_at IS NOT NULL))
);
-- One live entry per person and ticket type.
CREATE UNIQUE INDEX uq_waitlist_active ON waitlist_entries (user_id, ticket_type_id)
  WHERE status IN ('WAITING', 'OFFERED');
-- The offer job: the live entries of a ticket type, earliest first.
CREATE INDEX idx_waitlist_live ON waitlist_entries (ticket_type_id, created_at)
  WHERE status IN ('WAITING', 'OFFERED');
CREATE INDEX idx_waitlist_user ON waitlist_entries (user_id, created_at);
CREATE TRIGGER trg_waitlist_entries_updated_at BEFORE UPDATE ON waitlist_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS waitlist_entries;
