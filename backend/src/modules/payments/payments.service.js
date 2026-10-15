const env = require('../../config/env');
const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_PROVIDER } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { sha256 } = require('../../utils/crypto');
const { recordAudit } = require('../audit');
const orders = require('../orders');
const { publishAfterCommit } = require('../../realtime/publisher');
const { MESSAGE, userRoom } = require('../../realtime/messages');
const paymentsRepository = require('./payments.repository');
const simulator = require('./simulator');
const { startRefund, enqueueRefund } = require('./refunds');

const PAID_STATUSES = [ORDER_STATUS.PAID, ORDER_STATUS.COMPLETED];

const paymentNotFound = () => new AppError('NOT_FOUND', 'Payment not found.');
const orderNotFound = () => new AppError('NOT_FOUND', 'Order not found.');

function toPayment(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    provider: row.provider,
    providerTransactionId: row.provider_transaction_id,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

/** Same key + same body → the stored result; same key + another body → 422 (PAY-02). */
function replay(existing, requestHash) {
  if (existing.request_hash !== requestHash) throw new AppError('IDEMPOTENCY_KEY_REUSED');
  return { payment: toPayment(existing), replayed: true };
}

/**
 * Pay for one of my orders (PAY-01, PAY-02, PAY-04).
 *
 * Exactly-once, whatever the client retries:
 *  - same Idempotency-Key again (double click, network retry) → the first
 *    result is returned, the order is not charged again;
 *  - two different keys at once → the order row lock serializes them; the
 *    second sees PAID and gets ORDER_ALREADY_PAID (uq_payments_order_active
 *    is the database backstop).
 * A declined payment leaves the order PAYMENT_FAILED, still holding its
 * seats, so the customer can retry with a NEW key until the order expires.
 */
async function pay(context, actor, { orderId, simulate }, idempotencyKey) {
  // Phase 17: the simulator pays for free, so it is off in production by default.
  if (!env.PAYMENT_SIMULATOR) throw new AppError('PAYMENT_METHOD_DISABLED', 'The simulated payment is off on this server.');
  const requestHash = sha256(JSON.stringify({ orderId, simulate }));
  const earlier = await paymentsRepository.findByKey(pool, actor.userId, idempotencyKey);
  if (earlier) return replay(earlier, requestHash);

  const outcome = await withTransaction(async (client) => {
    const order = await orders.lockOrder(client, orderId);
    if (!order || order.user_id !== actor.userId) throw orderNotFound();

    // A request with the same key may have finished while we waited for the lock.
    const raced = await paymentsRepository.findByKey(client, actor.userId, idempotencyKey);
    if (raced) return { replayOf: raced };

    if (PAID_STATUSES.includes(order.status)) throw new AppError('ORDER_ALREADY_PAID');
    if (!orders.PAYABLE_STATUSES.includes(order.status)) {
      throw new AppError('ORDER_NOT_PAYABLE', order.status === ORDER_STATUS.HELD ? 'Check the order out first.' : undefined);
    }
    if (order.hold_expired) {
      await orders.releaseHeldOrder(client, orderId, { to: ORDER_STATUS.EXPIRED });
      return { expired: true }; // committed, then reported as ORDER_EXPIRED: nothing was charged
    }

    // An unfinished VNPay attempt is replaced (paid anyway → refunded as late money).
    const gatewayAttempt = await paymentsRepository.findPendingGatewayAttempt(client, orderId);
    if (gatewayAttempt) await paymentsRepository.cancelAttempt(client, gatewayAttempt.id);

    const pending = await paymentsRepository.insertPending(client, {
      orderId,
      userId: actor.userId,
      idempotencyKey,
      requestHash,
      provider: PAYMENT_PROVIDER.SIMULATOR,
      amount: order.total_amount, // always the server's price, never the client's
      currency: order.currency,
    });
    if (!pending) return { replayOf: await paymentsRepository.findByKey(client, actor.userId, idempotencyKey) };

    const result = simulator.charge({ amount: order.total_amount, simulate });
    const payment = await paymentsRepository.complete(client, pending.id, result);
    const succeeded = payment.status === PAYMENT_STATUS.SUCCESS;
    if (succeeded) await orders.markOrderPaid(client, orderId);
    else await orders.markPaymentFailed(client, orderId);

    publishAfterCommit(client, userRoom(actor.userId), {
      type: succeeded ? MESSAGE.PAYMENT_SUCCEEDED : MESSAGE.PAYMENT_FAILED,
      paymentId: payment.id,
      orderId,
      failureCode: payment.failure_code,
    });
    return { payment };
  });

  if (outcome.expired) throw new AppError('ORDER_EXPIRED');
  if (outcome.replayOf) return replay(outcome.replayOf, requestHash);
  return { payment: toPayment(outcome.payment), replayed: false };
}

/** PAY-03: the payer, or staff with payment:manage. */
async function getPayment(actor, paymentId) {
  const payment = await paymentsRepository.findById(pool, paymentId);
  if (!payment || (payment.user_id !== actor.userId && !actor.canManagePayments)) throw paymentNotFound();
  return toPayment(payment);
}

/**
 * Refund a paid order in the caller's transaction (order already locked):
 * refund row, payment REFUNDED, then the order and its inventory, audited.
 * A 0đ order has no payment: only the order part applies. A VNPay payment's
 * money goes back through the payments queue (refunds.js): the order and its
 * tickets are refunded now, the refund row says when VNPay has accepted it.
 */
async function refundLockedOrder(client, { orderId, payment, reason, context, amount = payment?.amount ?? 0, action = 'PAYMENT_REFUNDED' }) {
  // Phase 18.3: `amount` below the payment = a customer's cancellation; the rest is the fee kept.
  if (payment) {
    if (amount > 0) await startRefund(client, { payment, orderId, reason, amount, requestedBy: context?.userId ?? 'system' });
    await paymentsRepository.markRefunded(client, payment.id);
  }
  await orders.refundPaidOrder(client, orderId, { refundAmount: amount });
  await recordAudit(client, {
    context,
    action,
    entityType: 'order',
    entityId: orderId,
    oldValue: { status: ORDER_STATUS.PAID },
    newValue: {
      status: ORDER_STATUS.REFUNDED,
      paymentId: payment?.id ?? null,
      amount,
      fee: (payment?.amount ?? 0) - amount,
      reason,
    },
  });
}

/**
 * PAY-05: full refund of a successful payment, in ONE transaction. The order
 * is locked first (same lock order as paying), then the payment.
 */
async function refundPayment(context, paymentId, { reason }) {
  await withTransaction(async (client) => {
    const found = await paymentsRepository.findById(client, paymentId);
    if (!found) throw paymentNotFound();
    const order = await orders.lockOrder(client, found.order_id);
    const payment = await paymentsRepository.findById(client, paymentId, { forUpdate: true });
    if (payment.status !== PAYMENT_STATUS.SUCCESS || order.status !== ORDER_STATUS.PAID) {
      throw new AppError('PAYMENT_NOT_REFUNDABLE');
    }
    // Phase 10: the customer has been in. A cancelled event still refunds everyone (refundPaidOrders).
    if (await orders.hasCheckedInTickets(client, order.id)) {
      throw new AppError('PAYMENT_NOT_REFUNDABLE', 'Tickets of this order have already been checked in.');
    }
    await refundLockedOrder(client, { orderId: order.id, payment, reason, context });
  });
  return toPayment(await paymentsRepository.findById(pool, paymentId));
}

/**
 * EVT-08: an event or schedule is cancelled → refund every PAID order of it,
 * in the cancellation's transaction (instant with the simulated provider; a
 * real gateway moves this to a queue in Phase 9).
 * @returns {Promise<number>} orders refunded
 */
async function refundPaidOrders(client, scope, { reason, context }) {
  const ids = await orders.lockPaidOrders(client, scope);
  for (const orderId of ids) {
    const payment = await paymentsRepository.findSuccessfulOfOrder(client, orderId);
    await refundLockedOrder(client, { orderId, payment, reason, context });
  }
  return ids.length;
}

/** Phase 17: an admin sends a refund VNPay refused (or never answered) again. */
async function retryRefund(context, refundId) {
  return withTransaction(async (client) => {
    const refund = await paymentsRepository.reopenRefund(client, refundId);
    if (!refund) throw new AppError('REFUND_NOT_RETRYABLE');
    await recordAudit(client, {
      context,
      action: 'REFUND_RETRIED',
      entityType: 'order',
      entityId: refund.order_id,
      newValue: { refundId },
    });
    enqueueRefund(client, refundId, { again: true });
    return { refundId, orderId: refund.order_id, status: 'PENDING' };
  });
}

/** What the order page may offer (Phase 17). */
function paymentMethods() {
  return [...(env.VNPAY_ENABLED ? [PAYMENT_PROVIDER.VNPAY] : []), ...(env.PAYMENT_SIMULATOR ? [PAYMENT_PROVIDER.SIMULATOR] : [])];
}

module.exports = { pay, getPayment, refundPayment, refundPaidOrders, refundLockedOrder, retryRefund, paymentMethods };
