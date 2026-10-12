const COLUMNS = `id, order_id, user_id, idempotency_key, request_hash, provider, provider_transaction_id, amount,
  currency, status, failure_code, failure_message, paid_at, created_at, updated_at`;

/** The payment created by this user with this Idempotency-Key, if any. */
async function findByKey(db, userId, idempotencyKey) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM payments WHERE user_id = $1 AND idempotency_key = $2`, [
    userId,
    idempotencyKey,
  ]);
  return rows[0] ?? null;
}

async function findById(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM payments WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  return rows[0] ?? null;
}

/**
 * Record the attempt before calling the provider. ON CONFLICT DO NOTHING on
 * (user_id, idempotency_key): a duplicate request inserts nothing and is
 * answered with the first one's result.
 * @returns {Promise<object|null>} null when this key already has a payment
 */
async function insertPending(db, { orderId, userId, idempotencyKey, requestHash, provider, amount, currency }) {
  const { rows } = await db.query(
    `INSERT INTO payments (order_id, user_id, idempotency_key, request_hash, provider, amount, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING ${COLUMNS}`,
    [orderId, userId, idempotencyKey, requestHash, provider, amount, currency],
  );
  return rows[0] ?? null;
}

/** The provider answered. */
async function complete(db, id, { status, providerTransactionId, failureCode, failureMessage }) {
  const { rows } = await db.query(
    `UPDATE payments
     SET status = $2::payment_status, provider_transaction_id = $3, failure_code = $4, failure_message = $5,
         paid_at = CASE WHEN $2::payment_status = 'SUCCESS' THEN now() END
     WHERE id = $1 AND status = 'PENDING'
     RETURNING ${COLUMNS}`,
    [id, status, providerTransactionId, failureCode, failureMessage],
  );
  return rows[0];
}

/** The successful payment of an order, locked (refunds). */
async function findSuccessfulOfOrder(db, orderId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM payments WHERE order_id = $1 AND status = 'SUCCESS' FOR UPDATE`,
    [orderId],
  );
  return rows[0] ?? null;
}

async function markRefunded(db, id) {
  await db.query(`UPDATE payments SET status = 'REFUNDED' WHERE id = $1 AND status = 'SUCCESS'`, [id]);
}

/** Full refund, completed at once (simulated provider). uq_refunds_payment_active forbids a second one. */
async function insertRefund(db, { paymentId, orderId, amount, reason }) {
  const { rows } = await db.query(
    `INSERT INTO refunds (payment_id, order_id, amount, reason, status, provider_refund_id, completed_at)
     VALUES ($1, $2, $3, $4, 'SUCCESS', 'SIM-REFUND-' || gen_random_uuid(), now())
     RETURNING id`,
    [paymentId, orderId, amount, reason],
  );
  return rows[0].id;
}

module.exports = { findByKey, findById, insertPending, complete, findSuccessfulOfOrder, markRefunded, insertRefund };
