-- Up Migration

CREATE TABLE users (
  id                 uuid          NOT NULL DEFAULT gen_random_uuid(),
  email              citext        NOT NULL,
  password_hash      text          NOT NULL,
  first_name         varchar(100),
  last_name          varchar(100),
  phone              varchar(30),
  status             user_status   NOT NULL DEFAULT 'PENDING_VERIFICATION',
  email_verified_at  timestamptz,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_phone_key UNIQUE (phone),
  -- An ACTIVE account must have verified its email.
  CONSTRAINT chk_users_active_verified CHECK (status <> 'ACTIVE' OR email_verified_at IS NOT NULL)
);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE roles (
  id          uuid          NOT NULL DEFAULT gen_random_uuid(),
  code        varchar(50)   NOT NULL,
  name        varchar(100)  NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT roles_pkey PRIMARY KEY (id),
  CONSTRAINT roles_code_key UNIQUE (code)
);

CREATE TABLE permissions (
  id           uuid          NOT NULL DEFAULT gen_random_uuid(),
  code         varchar(100)  NOT NULL,
  name         varchar(150)  NOT NULL,
  description  text,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT permissions_pkey PRIMARY KEY (id),
  CONSTRAINT permissions_code_key UNIQUE (code)
);

-- n-n: users ↔ roles
CREATE TABLE user_roles (
  user_id     uuid         NOT NULL,
  role_id     uuid         NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id),
  CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles (id)
);
-- The PK already serves "roles of a user"; this one serves "users with a role".
CREATE INDEX idx_user_roles_role_id ON user_roles (role_id);

-- n-n: roles ↔ permissions
CREATE TABLE role_permissions (
  role_id        uuid  NOT NULL,
  permission_id  uuid  NOT NULL,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id),
  CONSTRAINT role_permissions_role_id_fkey
    FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT role_permissions_permission_id_fkey
    FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
);

-- Opaque refresh tokens. Only a SHA-256 hash is stored, so a leaked database
-- backup does not give an attacker usable tokens.
CREATE TABLE refresh_tokens (
  id              uuid         NOT NULL DEFAULT gen_random_uuid(),
  user_id         uuid         NOT NULL,
  token_hash      text         NOT NULL,
  family_id       uuid         NOT NULL,   -- all rotations of one login share it
  expires_at      timestamptz  NOT NULL,
  revoked_at      timestamptz,
  replaced_by_id  uuid,
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT refresh_tokens_replaced_by_id_fkey
    FOREIGN KEY (replaced_by_id) REFERENCES refresh_tokens (id) ON DELETE SET NULL
);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_family_id ON refresh_tokens (family_id);

-- Single-use tokens for email verification and password reset (hash only).
CREATE TABLE user_tokens (
  id          uuid             NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid             NOT NULL,
  type        user_token_type  NOT NULL,
  token_hash  text             NOT NULL,
  expires_at  timestamptz      NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT user_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT user_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT user_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_user_tokens_user_id_type ON user_tokens (user_id, type);

-- Down Migration

DROP TABLE IF EXISTS user_tokens;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS users;
