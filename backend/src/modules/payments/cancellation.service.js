const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { ORDER_STATUS, EVENT_STATUS, SCHEDULE_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const orders = require('../orders');
const paymentsRepository = require('./payments.repository');
const { refundTerms } = require('./refund-policy');

/**
 * Phase 18.3: a customer cancels their own paid order under the event's
 * refund policy. See docs/phase-18-customer-features-design.md, section 4.
 */

const POLICY_LABELS = { STANDARD: 'Tiêu chuẩn', FLEXIBLE: 'Linh hoạt' };
const orderNotFound = () => new AppError('NOT_FOUND', 'Order not found.');

/** The order with what the policy needs: its show and the event's policy. */
async function findOrderTerms(db, orderId) {
  const { rows } = await db.query(
    `SELECT o.id, o.user_id, o.status, o.total_amount, es.start_at, es.status AS schedule_status,
            e.status AS event_status, e.refund_policy
     FROM orders o
     JOIN event_schedules es ON es.id = o.schedule_id
     JOIN events e ON e.id = es.event_id
     WHERE o.id = $1`,
    [orderId],
  );
  return rows[0] ?? null;
}

/**
 * Can this order be cancelled by its buyer now, and for how much?
 * @returns {Promise<object>} { allowed, reason? , policy, percent, refundAmount, fee, tierEndsAt }
 */
async function evaluate(db, actor, orderId) {
  const row = await findOrderTerms(db, orderId);
  if (!row || row.user_id !== actor.userId) throw orderNotFound();
  const base = { policy: row.refund_policy, paidAmount: row.total_amount };
  if (row.status !== ORDER_STATUS.PAID) return { ...base, allowed: false, reason: 'NOT_PAID' };
  if (row.event_status !== EVENT_STATUS.PUBLISHED || row.schedule_status !== SCHEDULE_STATUS.SCHEDULED) {
    return { ...base, allowed: false, reason: 'SHOW_NOT_ON_SALE' };
  }
  if (await orders.hasCheckedInTickets(db, orderId)) return { ...base, allowed: false, reason: 'CHECKED_IN' };
  return { ...base, ...refundTerms({ policy: row.refund_policy, startAt: row.start_at, paidAmount: row.total_amount }) };
}

/** GET /orders/:id/cancellation: what cancelling now would give back. */
function previewCancellation(actor, orderId) {
  return evaluate(pool, actor, orderId);
}

/**
 * POST /orders/:id/cancellation. `refundAmount` is the amount the customer
 * saw and accepted: if a tier ended meanwhile, nothing happens (409 with the
 * new terms). One transaction, the order locked first (as every refund), so
 * two clicks refund once.
 * @param {(client, params) => Promise<void>} refundLockedOrder  payments.service (passed in: no require cycle)
 */
async function cancelOrder(context, actor, orderId, { refundAmount }, refundLockedOrder) {
  return withTransaction(async (client) => {
    if (!(await orders.lockOrder(client, orderId))) throw orderNotFound();
    const terms = await evaluate(client, actor, orderId);
    if (!terms.allowed) {
      throw new AppError('ORDER_NOT_CANCELLABLE', undefined, { details: { reason: terms.reason } });
    }
    if (terms.refundAmount !== refundAmount) {
      throw new AppError('REFUND_TERMS_CHANGED', undefined, {
        details: { refundAmount: terms.refundAmount, fee: terms.fee, percent: terms.percent },
      });
    }
    const payment = await paymentsRepository.findSuccessfulOfOrder(client, orderId);
    await refundLockedOrder(client, {
      orderId,
      payment,
      amount: terms.refundAmount,
      reason: `Khách hủy đơn (chính sách ${POLICY_LABELS[terms.policy]}, hoàn ${terms.percent}%)`,
      context,
      action: 'ORDER_CANCELLED_BY_CUSTOMER',
    });
    return { orderId, status: ORDER_STATUS.REFUNDED, refundAmount: terms.refundAmount, fee: terms.fee, percent: terms.percent };
  });
}

module.exports = { previewCancellation, cancelOrder };
