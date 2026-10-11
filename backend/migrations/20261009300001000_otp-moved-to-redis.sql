-- Up Migration
-- Phase 6: OTP codes now live in Redis (TTL, atomic Lua scripts); see
-- docs/phase-6-redis-design.md. The user_tokens table stays (it is part of
-- the original schema and can hold other single-use tokens later); only the
-- OTP rows, which nothing reads any more, are removed. Codes pending at
-- deploy time stop working: the user requests a new one.
DELETE FROM user_tokens WHERE type IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- Down Migration
-- Nothing to restore: deleted codes were short-lived and single-use anyway.
SELECT 1;
