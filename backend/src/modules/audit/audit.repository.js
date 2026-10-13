/**
 * Append a row to audit_logs. Always call it with the SAME transaction client
 * as the change being audited: either both are committed, or neither is.
 * (The table rejects UPDATE/DELETE through a trigger, so history is permanent.)
 *
 * @param {import('pg').PoolClient} db
 * @param {{ context: { userId: string|null, ip: string|null, userAgent: string|null },
 *           action: string, entityType: string, entityId: string,
 *           oldValue?: object, newValue?: object }} entry
 */
async function recordAudit(db, { context, action, entityType, entityId, oldValue = null, newValue = null }) {
  await db.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [context.userId, action, entityType, entityId, oldValue, newValue, context.ip, context.userAgent],
  );
}

/** AUD-02: newest first, with the email of who did it (null = system / worker). */
async function listAuditLogs(db, { entityType, entityId, userId, action, from, to, limit, offset }) {
  const params = [];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [];
  if (entityType) where.push(`a.entity_type = ${param(entityType)}`);
  if (entityId) where.push(`a.entity_id = ${param(entityId)}`);
  if (userId) where.push(`a.user_id = ${param(userId)}`);
  if (action) where.push(`a.action = ${param(action)}`);
  if (from) where.push(`a.created_at >= ${param(from)}`);
  if (to) where.push(`a.created_at < ${param(to)}`);
  const { rows } = await db.query(
    `SELECT a.id, a.user_id, u.email AS user_email, a.action, a.entity_type, a.entity_id, a.old_value, a.new_value,
            host(a.ip_address) AS ip_address, a.created_at, count(*) OVER () AS total_count
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.created_at DESC, a.id
     LIMIT ${param(limit)} OFFSET ${param(offset)}`,
    params,
  );
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

/** Distinct actions, for the filter of the audit page. */
async function listAuditActions(db) {
  const { rows } = await db.query(`SELECT DISTINCT action FROM audit_logs ORDER BY action`);
  return rows.map((row) => row.action);
}

module.exports = { recordAudit, listAuditLogs, listAuditActions };
