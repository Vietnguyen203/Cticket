-- Up Migration
-- "Ghi nhớ đăng nhập": a browser where the user passed the two-factor step
-- with the box ticked skips the code for 30 days (src/modules/auth/trusted-devices.js).
-- Only a hash of the cookie's token is stored.

CREATE TABLE trusted_devices (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  user_id       uuid          NOT NULL,
  token_hash    char(64)      NOT NULL,
  user_agent    varchar(300),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  last_used_at  timestamptz   NOT NULL DEFAULT now(),
  expires_at    timestamptz   NOT NULL,
  CONSTRAINT trusted_devices_pkey PRIMARY KEY (id),
  CONSTRAINT trusted_devices_token_hash_key UNIQUE (token_hash),
  CONSTRAINT trusted_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_trusted_devices_user ON trusted_devices (user_id, created_at DESC);

-- Down Migration

DROP TABLE IF EXISTS trusted_devices;
