-- Up Migration
-- Phase 15: two-factor authentication with an authenticator app (TOTP).

-- One TOTP secret per user. enabled_at NULL = set-up started, first code not
-- confirmed yet. The secret is ENCRYPTED (AES-256-GCM, TOTP_ENCRYPTION_KEY):
-- the server needs it back to compute codes, so it cannot be hashed.
CREATE TABLE user_totp (
  user_id           uuid         NOT NULL,
  secret_encrypted  text         NOT NULL,
  enabled_at        timestamptz,
  -- The last 30-second step a code was accepted for: a code never works twice.
  last_used_step    bigint       NOT NULL DEFAULT 0,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT user_totp_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_totp_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_user_totp_step CHECK (last_used_step >= 0)
);

-- Single-use recovery codes, for a lost phone. Only an HMAC is kept (the
-- codes have ~50 bits: a plain hash could be brute-forced from a leaked copy).
CREATE TABLE user_recovery_codes (
  id          uuid         NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid         NOT NULL,
  code_hash   text         NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT user_recovery_codes_pkey PRIMARY KEY (id),
  CONSTRAINT user_recovery_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT uq_user_recovery_codes_user_hash UNIQUE (user_id, code_hash)
);

-- A session opened with two-factor (copied to every rotation of its refresh
-- token). A refresh is refused for a user who needs two-factor when the
-- session was opened without it: sessions from before this phase, a user
-- just made an admin, other devices of someone who just turned it on.
ALTER TABLE refresh_tokens ADD COLUMN mfa boolean NOT NULL DEFAULT false;

-- Down Migration

ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS mfa;
DROP TABLE IF EXISTS user_recovery_codes;
DROP TABLE IF EXISTS user_totp;
