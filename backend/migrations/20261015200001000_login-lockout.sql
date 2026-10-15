-- Up Migration
-- Phase 18.1: a pause after repeated wrong passwords for one email.

-- Keyed by an HMAC of the email (OTP_SECRET), and kept for unknown emails
-- too: the answer is the same whether an account exists or not. No foreign
-- key to users for that reason.
CREATE TABLE login_attempts (
  email_hash       char(64)     NOT NULL,
  failures         int          NOT NULL DEFAULT 0,
  -- Locks so far in this streak: each one lasts twice as long as the last.
  lock_level       int          NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_failure_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT login_attempts_pkey PRIMARY KEY (email_hash),
  CONSTRAINT chk_login_attempts_counts CHECK (failures >= 0 AND lock_level >= 0)
);
-- The clean-up job removes old streaks.
CREATE INDEX idx_login_attempts_last_failure ON login_attempts (last_failure_at);

-- Down Migration

DROP TABLE IF EXISTS login_attempts;
