-- Up Migration

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- Case-insensitive text: 'A@x.com' and 'a@X.com' are the same email.
CREATE EXTENSION IF NOT EXISTS citext;
-- Trigram indexes: fast ILIKE '%keyword%' search on event titles.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------
-- Keeps updated_at correct even when an UPDATE forgets to set it:
-- the database enforces it, not the application.
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Used by schedule_seats: every UPDATE increments `version`. The version is
-- sent with WebSocket seat events so clients can ignore out-of-order messages.
CREATE FUNCTION bump_version() RETURNS trigger AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Used by audit_logs: history must be append-only.
CREATE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- ENUM types (same values as docs/database.dbml)
-- ---------------------------------------------------------------------------
CREATE TYPE user_status AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'INACTIVE', 'SUSPENDED');
CREATE TYPE user_token_type AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE organizer_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED');
CREATE TYPE event_status AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'CANCELLED', 'FINISHED');
CREATE TYPE venue_status AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE seat_type AS ENUM ('STANDARD', 'VIP', 'ACCESSIBLE', 'COMPANION');
CREATE TYPE schedule_status AS ENUM ('SCHEDULED', 'CANCELLED', 'FINISHED');
CREATE TYPE schedule_seat_status AS ENUM ('AVAILABLE', 'HELD', 'SOLD', 'BLOCKED');
CREATE TYPE ticket_type_status AS ENUM ('ACTIVE', 'INACTIVE', 'SOLD_OUT');
CREATE TYPE order_status AS ENUM (
  'PENDING', 'HELD', 'PAYMENT_PENDING', 'PAID', 'COMPLETED',
  'EXPIRED', 'CANCELLED', 'PAYMENT_FAILED', 'REFUNDED'
);
CREATE TYPE payment_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED');
CREATE TYPE refund_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
CREATE TYPE ticket_status AS ENUM ('VALID', 'USED', 'CANCELLED', 'REFUNDED');
CREATE TYPE discount_type AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');
CREATE TYPE promotion_status AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED');
CREATE TYPE review_status AS ENUM ('PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED');

-- Down Migration

DROP TYPE IF EXISTS review_status;
DROP TYPE IF EXISTS promotion_status;
DROP TYPE IF EXISTS discount_type;
DROP TYPE IF EXISTS ticket_status;
DROP TYPE IF EXISTS refund_status;
DROP TYPE IF EXISTS payment_status;
DROP TYPE IF EXISTS order_status;
DROP TYPE IF EXISTS ticket_type_status;
DROP TYPE IF EXISTS schedule_seat_status;
DROP TYPE IF EXISTS schedule_status;
DROP TYPE IF EXISTS seat_type;
DROP TYPE IF EXISTS venue_status;
DROP TYPE IF EXISTS event_status;
DROP TYPE IF EXISTS organizer_status;
DROP TYPE IF EXISTS user_token_type;
DROP TYPE IF EXISTS user_status;
DROP FUNCTION IF EXISTS reject_mutation();
DROP FUNCTION IF EXISTS bump_version();
DROP FUNCTION IF EXISTS set_updated_at();
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS citext;
