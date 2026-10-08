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

module.exports = { recordAudit };
