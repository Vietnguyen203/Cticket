const COLUMNS = `id, order_id, user_id, idempotency_key, request_hash, provider, provider_transaction_id, amount,
  currency, status, failure_code, failure_message, paid_at, created_at, updated_at,
  provider_ref, provider_create_date, provider_response_code`;

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

// ---------------------------------------------------------------------------
// Payment gateways (Phase 17: VNPay)
// ---------------------------------------------------------------------------

/**
 * A new attempt, waiting for the gateway. uq_payments_order_active lets an
 * order have only one at a time (the caller cancels the previous one first).
 */
async function insertGatewayAttempt(db, { id, orderId, userId, provider, providerRef, providerCreateDate, amount, currency }) {
  const { rows } = await db.query(
    `INSERT INTO payments (id, order_id, user_id, idempotency_key, request_hash, provider, provider_ref,
                           provider_create_date, amount, currency)
     VALUES ($1::uuid, $2, $3, 'gateway:' || $1::text, encode(sha256(convert_to($1::text, 'UTF8')), 'hex'), $4, $5, $6, $7, $8)
     RETURNING ${COLUMNS}`,
    [id, orderId, userId, provider, providerRef, providerCreateDate, amount, currency],
  );
  return rows[0];
}

async function findByProviderRef(db, provider, providerRef) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM payments WHERE provider = $1 AND provider_ref = $2`, [
    provider,
    providerRef,
  ]);
  return rows[0] ?? null;
}

/** The attempt of an order still waiting for its gateway, if any. */
async function findPendingGatewayAttempt(db, orderId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM payments WHERE order_id = $1 AND status = 'PENDING' AND provider_ref IS NOT NULL`,
    [orderId],
  );
  return rows[0] ?? null;
}

/**
 * The gateway's verdict on a PENDING attempt (compare-and-set: applied once).
 * @returns {Promise<object|null>} null when the attempt was no longer PENDING
 */
async function settleAttempt(db, id, { status, transactionNo, responseCode, data, failureMessage = null }) {
  // A FAILED attempt may still turn SUCCESS: VNPay took the money after all (bug review BUG-01).
  const { rows } = await db.query(
    `UPDATE payments
     SET status = $2::payment_status, provider_transaction_id = $3, provider_response_code = $4::text, provider_data = $5,
         failure_code = CASE WHEN $2::payment_status = 'FAILED' THEN $4::text END, failure_message = $6,
         paid_at = CASE WHEN $2::payment_status = 'SUCCESS' THEN now() END
     WHERE id = $1 AND (status = 'PENDING' OR (status = 'FAILED' AND $2::payment_status = 'SUCCESS'))
     RETURNING ${COLUMNS}`,
    [id, status, transactionNo, responseCode, data, failureMessage],
  );
  return rows[0] ?? null;
}

/** The customer gave up (new attempt, order cancelled or expired): this attempt will not be used. */
async function cancelAttempt(db, id) {
  const { rows } = await db.query(
    `UPDATE payments SET status = 'CANCELLED' WHERE id = $1 AND status = 'PENDING' RETURNING ${COLUMNS}`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Money arrived for an attempt the order can no longer use (it expired, was
 * cancelled, or another attempt paid it): recorded as paid AND refunded at
 * once; the refund row follows.
 */
async function markLateMoney(db, id, { transactionNo, responseCode, data }) {
  const { rows } = await db.query(
    `UPDATE payments
     SET status = 'REFUNDED', paid_at = now(), provider_transaction_id = $2, provider_response_code = $3, provider_data = $4,
         failure_message = 'Paid after the order could no longer use it: refunded'
     WHERE id = $1 AND status IN ('PENDING', 'CANCELLED', 'FAILED')
     RETURNING ${COLUMNS}`,
    [id, transactionNo, responseCode, data],
  );
  return rows[0] ?? null;
}

/**
 * Attempts to ask the gateway about: their order's hold has run out, or they
 * are old enough that the customer has surely left VNPay's page.
 */
async function findAttemptsToReconcile(db, { olderThanSeconds, limit }) {
  const { rows } = await db.query(
    `SELECT p.id, p.order_id, p.provider_ref, p.provider_create_date, o.expires_at,
            extract(epoch FROM now() - o.expires_at)::int AS seconds_past_deadline
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.status = 'PENDING' AND p.provider_ref IS NOT NULL
       AND (o.expires_at <= now() OR p.created_at <= now() - make_interval(secs => $1))
     ORDER BY p.created_at
     LIMIT $2`,
    [olderThanSeconds, limit],
  );
  return rows;
}

// --- refunds through a gateway -------------------------------------------------

/** A refund the gateway still has to accept (the job does it). */
async function insertPendingRefund(db, { paymentId, orderId, amount, reason, requestedBy }) {
  const { rows } = await db.query(
    `INSERT INTO refunds (payment_id, order_id, amount, reason, status, requested_by)
     VALUES ($1, $2, $3, $4, 'PENDING', $5)
     RETURNING id`,
    [paymentId, orderId, amount, reason, requestedBy],
  );
  return rows[0].id;
}

/** A refund with what the gateway needs about its payment, locked. */
async function lockRefund(db, id) {
  const { rows } = await db.query(
    `SELECT r.id, r.status, r.amount, r.order_id, r.requested_by, r.attempts,
            p.id AS payment_id, p.amount AS payment_amount, p.provider, p.provider_ref, p.provider_create_date, p.provider_transaction_id
     FROM refunds r JOIN payments p ON p.id = r.payment_id
     WHERE r.id = $1
     FOR UPDATE OF r`,
    [id],
  );
  return rows[0] ?? null;
}

async function countRefundAttempt(db, id) {
  await db.query(`UPDATE refunds SET attempts = attempts + 1 WHERE id = $1`, [id]);
}

async function completeRefund(db, id, { providerRefundId, data }) {
  await db.query(
    `UPDATE refunds SET status = 'SUCCESS', provider_refund_id = $2, provider_data = $3, completed_at = now(), failure_message = NULL
     WHERE id = $1 AND status = 'PENDING'`,
    [id, providerRefundId, data],
  );
}

async function failRefund(db, id, { message, data = null }) {
  await db.query(
    `UPDATE refunds SET status = 'FAILED', failure_message = $2, provider_data = coalesce($3, provider_data)
     WHERE id = $1 AND status = 'PENDING'`,
    [id, message, data],
  );
}

/** An admin sends a failed refund again. @returns {Promise<object|null>} null unless it was FAILED */
async function reopenRefund(db, id) {
  const { rows } = await db.query(
    `UPDATE refunds SET status = 'PENDING', failure_message = NULL WHERE id = $1 AND status = 'FAILED'
     RETURNING id, order_id`,
    [id],
  );
  return rows[0] ?? null;
}

module.exports = {
  findByKey,
  findById,
  insertPending,
  complete,
  findSuccessfulOfOrder,
  markRefunded,
  insertRefund,
  insertGatewayAttempt,
  findByProviderRef,
  findPendingGatewayAttempt,
  settleAttempt,
  cancelAttempt,
  markLateMoney,
  findAttemptsToReconcile,
  insertPendingRefund,
  lockRefund,
  countRefundAttempt,
  completeRefund,
  failRefund,
  reopenRefund,
};
