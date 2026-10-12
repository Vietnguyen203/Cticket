const { buildSetClause } = require('../../utils/sql');

const COLUMNS = `id, code, name, discount_type, discount_value, max_discount, min_order_amount, usage_limit,
  used_count, per_user_limit, starts_at, expires_at, status, created_at, updated_at`;

const UPDATABLE = {
  name: 'name',
  discountType: 'discount_type',
  discountValue: 'discount_value',
  maxDiscount: 'max_discount',
  minOrderAmount: 'min_order_amount',
  usageLimit: 'usage_limit',
  perUserLimit: 'per_user_limit',
  startsAt: 'starts_at',
  expiresAt: 'expires_at',
  status: 'status',
};

async function insert(db, p) {
  const { rows } = await db.query(
    `INSERT INTO promotions (code, name, discount_type, discount_value, max_discount, min_order_amount,
                             usage_limit, per_user_limit, starts_at, expires_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${COLUMNS}`,
    [
      p.code,
      p.name,
      p.discountType,
      p.discountValue,
      p.maxDiscount ?? null,
      p.minOrderAmount,
      p.usageLimit ?? null,
      p.perUserLimit ?? null,
      p.startsAt,
      p.expiresAt,
      p.status,
    ],
  );
  return rows[0];
}

async function update(db, id, changes) {
  const { clause, params } = buildSetClause(changes, UPDATABLE, 2);
  const { rows } = await db.query(`UPDATE promotions SET ${clause} WHERE id = $1 RETURNING ${COLUMNS}`, [id, ...params]);
  return rows[0] ?? null;
}

async function findById(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM promotions WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  return rows[0] ?? null;
}

/** Codes are stored upper-case. FOR UPDATE serializes everyone checking out with the same code. */
async function findByCode(db, code, { forUpdate = false } = {}) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM promotions WHERE code = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [
    code,
  ]);
  return rows[0] ?? null;
}

async function list(db, { status, limit, offset }) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, count(*) OVER () AS total_count FROM promotions
     WHERE ($1::promotion_status IS NULL OR status = $1)
     ORDER BY created_at DESC, id
     LIMIT $2 OFFSET $3`,
    [status ?? null, limit, offset],
  );
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

/** Uses by this user that still count: rows are deleted when an unpaid order ends. */
async function countUsesByUser(db, promotionId, userId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS uses FROM promotion_usages WHERE promotion_id = $1 AND user_id = $2`,
    [promotionId, userId],
  );
  return rows[0].uses;
}

/**
 * Take one use. Conditional UPDATE: with the last use left, two concurrent
 * checkouts cannot both succeed (chk_promotions_used_count backs it up).
 * @returns {Promise<boolean>}
 */
async function takeUse(db, promotionId) {
  const { rowCount } = await db.query(
    `UPDATE promotions SET used_count = used_count + 1
     WHERE id = $1 AND (usage_limit IS NULL OR used_count < usage_limit)`,
    [promotionId],
  );
  return rowCount === 1;
}

async function insertUsage(db, { promotionId, userId, orderId, discountAmount }) {
  await db.query(
    `INSERT INTO promotion_usages (promotion_id, user_id, order_id, discount_amount) VALUES ($1, $2, $3, $4)`,
    [promotionId, userId, orderId, discountAmount],
  );
}

/** An unpaid order ended: give its use back. @returns {Promise<number>} uses returned */
async function returnUsesOfOrder(db, orderId) {
  const { rows } = await db.query(`DELETE FROM promotion_usages WHERE order_id = $1 RETURNING promotion_id`, [orderId]);
  for (const { promotion_id: promotionId } of rows) {
    await db.query(`UPDATE promotions SET used_count = used_count - 1 WHERE id = $1 AND used_count > 0`, [promotionId]);
  }
  return rows.length;
}

module.exports = {
  insert,
  update,
  findById,
  findByCode,
  list,
  countUsesByUser,
  takeUse,
  insertUsage,
  returnUsesOfOrder,
};
