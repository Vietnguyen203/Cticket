/**
 * SQL for users, user_roles and role permissions.
 * Every function takes `db` first: the pool for standalone queries, or a
 * transaction client so the query joins the caller's transaction.
 */

const { buildSetClause } = require('../../utils/sql');

const USER_COLUMNS = `id, email, password_hash, first_name, last_name, phone, status,
  email_verified_at, event_reminders, created_at, updated_at`;

const PROFILE_COLUMNS = { firstName: 'first_name', lastName: 'last_name', phone: 'phone', eventReminders: 'event_reminders' };

async function insertUser(db, { email, passwordHash, firstName, lastName, phone = null, status, emailVerifiedAt = null }) {
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, phone, status, email_verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${USER_COLUMNS}`,
    [email, passwordHash, firstName, lastName, phone, status, emailVerifiedAt],
  );
  return rows[0];
}

/**
 * `email` is citext, so the lookup is case-insensitive.
 * forUpdate locks the user row until the transaction ends.
 */
async function findByEmail(db, email, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [email],
  );
  return rows[0] ?? null;
}

async function findById(db, userId) {
  const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);
  return rows[0] ?? null;
}

/**
 * Profile fields only (never email, password or status). A phone number
 * that belongs to someone else fails users_phone_key → 409 PHONE_TAKEN.
 */
async function updateProfile(db, userId, changes) {
  const { clause, params } = buildSetClause(changes, PROFILE_COLUMNS, 2);
  const { rows } = await db.query(`UPDATE users SET ${clause} WHERE id = $1 RETURNING ${USER_COLUMNS}`, [
    userId,
    ...params,
  ]);
  return rows[0] ?? null;
}

/** Idempotent: granting a role the user already has is a no-op. */
async function addRole(db, userId, roleCode) {
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE code = $2
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, roleCode],
  );
}

/**
 * Lock a user row until the transaction ends. Lock order across modules:
 * users → organizers (admin role changes and organizer approvals both touch
 * a user's roles and organizer profile).
 */
async function lockUser(db, userId) {
  await db.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [userId]);
}

async function findRoleCodes(db, userId) {
  const { rows } = await db.query(
    `SELECT r.code
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1
     ORDER BY r.code`,
    [userId],
  );
  return rows.map((row) => row.code);
}

/** PENDING_VERIFICATION → ACTIVE. The WHERE makes it a no-op for any other status. */
async function markEmailVerified(db, userId) {
  await db.query(
    `UPDATE users SET status = 'ACTIVE', email_verified_at = now()
     WHERE id = $1 AND status = 'PENDING_VERIFICATION'`,
    [userId],
  );
}

async function updatePasswordHash(db, userId, passwordHash) {
  await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, passwordHash]);
}

async function findAllRolePermissions(db) {
  const { rows } = await db.query(
    `SELECT r.code AS role, p.code AS permission
     FROM role_permissions rp
     JOIN roles r ON r.id = rp.role_id
     JOIN permissions p ON p.id = rp.permission_id`,
  );
  return rows;
}

module.exports = {
  updateProfile,
  insertUser,
  findByEmail,
  findById,
  addRole,
  lockUser,
  findRoleCodes,
  markEmailVerified,
  updatePasswordHash,
  findAllRolePermissions,
};
