-- Up Migration
-- user_tokens now stores 6-digit email OTPs (email verification, password reset).
--
-- 1. token_hash can no longer be UNIQUE: there are only 1,000,000 possible
--    codes, so two users will regularly receive the same code. The hash is an
--    HMAC of (user_id, purpose, code), looked up by (user_id, type), not by hash.
-- 2. attempts: wrong guesses are counted; after the limit the code is revoked.
--    This is what makes a 6-digit code safe against brute force.
-- 3. revoked_at: a code is revoked when a newer one is issued or when the
--    attempt limit is reached. Rows are kept to enforce resend limits.

ALTER TABLE user_tokens DROP CONSTRAINT user_tokens_token_hash_key;

ALTER TABLE user_tokens
  ADD COLUMN attempts int NOT NULL DEFAULT 0,
  ADD COLUMN revoked_at timestamptz,
  ADD CONSTRAINT chk_user_tokens_attempts CHECK (attempts >= 0);

-- At most ONE usable code per user and purpose.
CREATE UNIQUE INDEX uq_user_tokens_active ON user_tokens (user_id, type)
  WHERE used_at IS NULL AND revoked_at IS NULL;

-- Resend limits count codes issued recently: WHERE user_id, type AND created_at > ...
DROP INDEX idx_user_tokens_user_id_type;
CREATE INDEX idx_user_tokens_user_id_type_created_at ON user_tokens (user_id, type, created_at);

-- Down Migration

DROP INDEX IF EXISTS idx_user_tokens_user_id_type_created_at;
CREATE INDEX idx_user_tokens_user_id_type ON user_tokens (user_id, type);
DROP INDEX IF EXISTS uq_user_tokens_active;
ALTER TABLE user_tokens
  DROP CONSTRAINT IF EXISTS chk_user_tokens_attempts,
  DROP COLUMN IF EXISTS revoked_at,
  DROP COLUMN IF EXISTS attempts;
-- Fails if duplicate hashes exist; acceptable for a development rollback.
ALTER TABLE user_tokens ADD CONSTRAINT user_tokens_token_hash_key UNIQUE (token_hash);
