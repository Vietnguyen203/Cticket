const COLUMNS = 'id, user_id, organization_name, description, tax_code, status, created_at, updated_at';

async function findByUserId(db, userId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM organizers WHERE user_id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [userId],
  );
  return rows[0] ?? null;
}

async function findById(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM organizers WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  return rows[0] ?? null;
}

async function insert(db, { userId, organizationName, description = null, taxCode = null }) {
  const { rows } = await db.query(
    `INSERT INTO organizers (user_id, organization_name, description, tax_code)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [userId, organizationName, description, taxCode],
  );
  return rows[0];
}

/** A REJECTED applicant applies again with new details. */
async function reapply(db, id, { organizationName, description = null, taxCode = null }) {
  const { rows } = await db.query(
    `UPDATE organizers
     SET organization_name = $2, description = $3, tax_code = $4, status = 'PENDING'
     WHERE id = $1 AND status = 'REJECTED'
     RETURNING ${COLUMNS}`,
    [id, organizationName, description, taxCode],
  );
  return rows[0] ?? null;
}

/** Compare-and-set: only changes the row if it is still in the `from` status. */
async function updateStatus(db, id, { from, to }) {
  const { rows } = await db.query(
    `UPDATE organizers SET status = $3 WHERE id = $1 AND status = $2 RETURNING ${COLUMNS}`,
    [id, from, to],
  );
  return rows[0] ?? null;
}

/** Admin review list, with the applicant's account email. */
async function list(db, { status, limit, offset }) {
  const params = [limit, offset];
  const where = status ? `WHERE o.status = $${params.push(status)}` : '';
  const { rows } = await db.query(
    `SELECT o.id, o.user_id, o.organization_name, o.description, o.tax_code, o.status,
            o.created_at, o.updated_at, u.email AS user_email,
            count(*) OVER () AS total
     FROM organizers o
     JOIN users u ON u.id = o.user_id
     ${where}
     ORDER BY o.created_at, o.id
     LIMIT $1 OFFSET $2`,
    params,
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

module.exports = { findByUserId, findById, insert, reapply, updateStatus, list };
