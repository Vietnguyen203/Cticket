/**
 * Admin queries on users (USR-03/04/05). Never selects password_hash.
 */
const { escapeLike } = require('../../utils/pagination');

const COLUMNS = `u.id, u.email, u.first_name, u.last_name, u.phone, u.status, u.email_verified_at, u.created_at`;
const ROLES = `coalesce((SELECT array_agg(r.code ORDER BY r.code) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                         WHERE ur.user_id = u.id), '{}') AS roles`;

/** Search by email / name, filter by role and status; newest first. */
async function list(db, { q, role, status, limit, offset }) {
  const params = [];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [];
  if (q) {
    const like = param(`%${escapeLike(q)}%`);
    where.push(
      `(u.email ILIKE ${like} ESCAPE '\\' OR immutable_unaccent(lower(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')))
         LIKE immutable_unaccent(lower(${like})) ESCAPE '\\')`,
    );
  }
  if (status) where.push(`u.status = ${param(status)}::user_status`);
  if (role) where.push(`EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code = ${param(role)})`);

  const { rows } = await db.query(
    `SELECT ${COLUMNS}, ${ROLES}, count(*) OVER () AS total_count
     FROM users u
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY u.created_at DESC, u.id
     LIMIT ${param(limit)} OFFSET ${param(offset)}`,
    params,
  );
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

async function findForUpdate(db, userId) {
  const { rows } = await db.query(`SELECT ${COLUMNS}, ${ROLES} FROM users u WHERE u.id = $1 FOR UPDATE OF u`, [userId]);
  return rows[0] ?? null;
}

async function setStatus(db, userId, status) {
  await db.query(`UPDATE users SET status = $2::user_status WHERE id = $1`, [userId, status]);
}

/**
 * Lock the ADMIN role rows: two admins changing roles at the same time run
 * one after the other, so "keep at least one admin" cannot be raced.
 * @returns {Promise<string[]>} ids of the ACTIVE admins
 */
async function lockActiveAdmins(db) {
  const { rows } = await db.query(
    `SELECT ur.user_id FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id AND r.code = 'ADMIN'
     JOIN users u ON u.id = ur.user_id
     WHERE u.status = 'ACTIVE'
     ORDER BY ur.user_id
     FOR UPDATE OF ur`,
  );
  return rows.map((row) => row.user_id);
}

/** Replace the user's roles with exactly `roleCodes`. */
async function replaceRoles(db, userId, roleCodes) {
  await db.query(
    `DELETE FROM user_roles ur USING roles r WHERE ur.role_id = r.id AND ur.user_id = $1 AND NOT (r.code = ANY($2::text[]))`,
    [userId, roleCodes],
  );
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE code = ANY($2::text[])
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, roleCodes],
  );
}

module.exports = { list, findForUpdate, setStatus, lockActiveAdmins, replaceRoles };
