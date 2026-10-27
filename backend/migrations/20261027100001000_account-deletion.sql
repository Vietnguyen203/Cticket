-- Up Migration
-- A user deletes their own account (Luật Bảo vệ dữ liệu cá nhân 2025: the
-- right to have one's personal data deleted). The row stays, anonymised, so
-- orders, payments and refunds keep their buyer for the accounts (the law
-- lets records needed for other legal duties be kept): see
-- src/modules/account/account.service.js.

ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'DELETED';

ALTER TABLE users ADD COLUMN deleted_at timestamptz;

-- Down Migration

-- An enum value cannot be dropped; DELETED stays unused.
ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
