const { randomUUID } = require('node:crypto');
const env = require('../../config/env');
const { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_PROVIDER, VNPAY } = require('../../config/constants');
const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { recordAudit } = require('../audit');
const orders = require('../orders');
const { publishAfterCommit } = require('../../realtime/publisher');
const { MESSAGE, userRoom } = require('../../realtime/messages');
const { QUEUE, enqueueAfterCommit } = require('../../queue/queues');
const mailer = require('../../mail/mailer');
const { paymentReturnedEmail } = require('../../mail/templates');
const paymentsRepository = require('./payments.repository');
const { startRefund } = require('./refunds');
const vnpay = require('./vnpay');

/**
 * Payments through VNPay (Phase 17). See docs/phase-17-vnpay-design.md.
 *
 * One attempt = one payments row (PENDING until VNPay says how it ended).
 * The verdict comes three ways, all through applyGatewayResult (idempotent,
 * one transaction, order row locked first):
 *   - the IPN (VNPay's server calls ours): the main way;
 *   - the Return URL, after asking VNPay again (querydr): the customer sees
 *     the result at once, and it works without a public IPN address;
 *   - reconciliation (every minute): attempts whose order reached its
 *     deadline are asked about before the seats go back on sale.
 */

const SYSTEM_CONTEXT = Object.freeze({ userId: null, ip: null, userAgent: 'payments' });
const PAID_STATUSES = [ORDER_STATUS.PAID, ORDER_STATUS.COMPLETED];
// Old enough that the customer has surely left VNPay's page.
const STALE_ATTEMPT_SECONDS = 900;

const orderNotFound = () => new AppError('NOT_FOUND', 'Order not found.');

function assertEnabled() {
  if (!env.VNPAY_ENABLED) throw new AppError('PAYMENT_METHOD_DISABLED', 'VNPay is not configured on this server.');
}

/** VNPay wants an IPv4 / IPv6 address of 7–45 characters ("::1" is too short). */
function customerIp(ip) {
  const address = String(ip ?? '').replace(/^::ffff:/, '');
  return address.length >= 7 && address.length <= 45 ? address : '127.0.0.1';
}

// ---------------------------------------------------------------------------
// Applying VNPay's verdict
// ---------------------------------------------------------------------------

/**
 * Apply what VNPay says about one attempt. Idempotent: the same verdict a
 * second time changes nothing ('ALREADY').
 * - paid, order waiting for it          → SUCCESS, order PAID, tickets issued
 * - paid, order can no longer use it    → "late money": REFUNDED, refund queued, email
 *   (expired, cancelled, or paid by another attempt)
 * - not paid                            → FAILED, order PAYMENT_FAILED (can pay again)
 * @returns {Promise<{ result: 'APPLIED'|'ALREADY'|'NOT_FOUND'|'AMOUNT_MISMATCH', status?: string }>}
 */
async function applyGatewayResult(paymentId, { paid, responseCode, amount, transactionNo, data }) {
  return withTransaction(async (client) => {
    const found = await paymentsRepository.findById(client, paymentId);
    if (!found) return { result: 'NOT_FOUND' };
    // Lock order: the order row, then its payment (as paying and refunding do).
    const order = await orders.lockOrder(client, found.order_id);
    const payment = await paymentsRepository.findById(client, paymentId, { forUpdate: true });
    if (amount !== payment.amount) return { result: 'AMOUNT_MISMATCH' };
    const fields = { transactionNo, responseCode, data };
    const room = userRoom(payment.user_id);

    if (paid) {
      if (payment.status === PAYMENT_STATUS.PENDING && orders.PAYABLE_STATUSES.includes(order.status)) {
        await paymentsRepository.settleAttempt(client, paymentId, { status: PAYMENT_STATUS.SUCCESS, ...fields });
        await orders.markOrderPaid(client, order.id);
        publishAfterCommit(client, room, { type: MESSAGE.PAYMENT_SUCCEEDED, paymentId, orderId: order.id });
        return { result: 'APPLIED', status: PAYMENT_STATUS.SUCCESS };
      }
      if (payment.status === PAYMENT_STATUS.PENDING || payment.status === PAYMENT_STATUS.CANCELLED) {
        const late = await paymentsRepository.markLateMoney(client, paymentId, fields);
        await startRefund(client, {
          payment: late,
          orderId: order.id,
          reason: 'Thanh toán VNPay đến khi đơn không còn chờ thanh toán (hết hạn, đã hủy hoặc đã trả bằng lượt khác)',
          requestedBy: 'system',
        });
        await recordAudit(client, {
          context: SYSTEM_CONTEXT,
          action: 'LATE_PAYMENT_REFUNDED',
          entityType: 'order',
          entityId: order.id,
          oldValue: { orderStatus: order.status, paymentStatus: payment.status },
          newValue: { paymentId, amount: payment.amount, transactionNo },
        });
        enqueueAfterCommit(client, QUEUE.EMAILS, 'payment-returned', { paymentId }, { jobId: `payment-returned-${paymentId}` });
        return { result: 'APPLIED', status: PAYMENT_STATUS.REFUNDED };
      }
      return { result: 'ALREADY' };
    }

    if (payment.status !== PAYMENT_STATUS.PENDING) return { result: 'ALREADY' };
    await paymentsRepository.settleAttempt(client, paymentId, {
      status: PAYMENT_STATUS.FAILED,
      ...fields,
      failureMessage: `VNPay: ${responseCode}`,
    });
    if (orders.PAYABLE_STATUSES.includes(order.status)) await orders.markPaymentFailed(client, order.id);
    publishAfterCommit(client, room, { type: MESSAGE.PAYMENT_FAILED, paymentId, orderId: order.id, failureCode: responseCode });
    return { result: 'APPLIED', status: PAYMENT_STATUS.FAILED };
  });
}

/**
 * Ask VNPay about a PENDING attempt (querydr) and apply a final answer.
 * @param {string} [reason]  VNPay's own reason for a failure, from a signed
 *   callback of this attempt (24 cancelled, 51 no funds…): querydr only says "failed"
 * @returns {Promise<'PAID'|'FAILED'|'OPEN'|'NOT_FOUND'|'UNKNOWN'>} UNKNOWN: VNPay could not be asked
 */
async function reconcileAttempt(attempt, { reason } = {}) {
  let answer;
  try {
    answer = await vnpay.queryTransaction({ txnRef: attempt.provider_ref, transactionDate: attempt.provider_create_date });
  } catch (err) {
    if (!(err instanceof vnpay.VnpayUnavailableError)) throw err;
    logger.warn({ err: { message: err.message }, paymentId: attempt.id }, 'VNPay querydr gave no answer');
    return 'UNKNOWN';
  }
  if (answer.state === 'PAID') await applyGatewayResult(attempt.id, { ...answer.outcome, data: answer.data });
  if (answer.state === 'FAILED') {
    const responseCode = reason && reason !== '00' ? reason : answer.outcome.responseCode;
    await applyGatewayResult(attempt.id, { ...answer.outcome, responseCode, data: answer.data });
  }
  return answer.state;
}

// ---------------------------------------------------------------------------
// Starting a payment
// ---------------------------------------------------------------------------

/**
 * POST /payments/vnpay: a new attempt and the URL that sends the customer to
 * VNPay. An earlier attempt still open is asked about first: paid → the order
 * is paid; otherwise it is replaced (if it gets paid anyway, the money is
 * refunded). VNPay stops taking money EXPIRE_MARGIN before the order's deadline.
 */
async function startPayment(actor, { orderId }, { ip }) {
  assertEnabled();
  const previous = await paymentsRepository.findPendingGatewayAttempt(pool, orderId);
  if (previous) {
    if (previous.user_id !== actor.userId) throw orderNotFound();
    const state = await reconcileAttempt(previous);
    if (state === 'PAID') throw new AppError('ORDER_ALREADY_PAID');
    // Not sure the old attempt is unpaid: do not open a second one.
    if (state === 'UNKNOWN') throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE');
  }

  const id = randomUUID();
  const createDate = vnpay.vnTime();
  const { payment, order } = await withTransaction(async (client) => {
    const locked = await orders.lockOrder(client, orderId);
    if (!locked || locked.user_id !== actor.userId) throw orderNotFound();
    if (PAID_STATUSES.includes(locked.status)) throw new AppError('ORDER_ALREADY_PAID');
    if (!orders.PAYABLE_STATUSES.includes(locked.status)) {
      throw new AppError('ORDER_NOT_PAYABLE', locked.status === ORDER_STATUS.HELD ? 'Check the order out first.' : undefined);
    }
    if ((locked.remaining_seconds ?? 0) < VNPAY.MIN_SECONDS_TO_PAY) {
      throw new AppError('ORDER_NOT_PAYABLE', 'Not enough time is left to pay this order; book again.');
    }
    // Another tab may have opened one meanwhile: one attempt at a time.
    const open = await paymentsRepository.findPendingGatewayAttempt(client, orderId);
    if (open) await paymentsRepository.cancelAttempt(client, open.id);
    const attempt = await paymentsRepository.insertGatewayAttempt(client, {
      id,
      orderId,
      userId: actor.userId,
      provider: PAYMENT_PROVIDER.VNPAY,
      providerRef: id.replace(/-/g, ''),
      providerCreateDate: createDate,
      amount: locked.total_amount, // always the server's price
      currency: locked.currency,
    });
    return { payment: attempt, order: locked };
  });

  const deadline = new Date(order.expires_at).getTime() - VNPAY.EXPIRE_MARGIN_SECONDS * 1000;
  return {
    paymentId: payment.id,
    paymentUrl: vnpay.paymentUrl({
      txnRef: payment.provider_ref,
      amount: payment.amount,
      orderInfo: `Thanh toan don ${order.order_code}`,
      ipAddr: customerIp(ip),
      createDate,
      expireDate: vnpay.vnTime(new Date(deadline)),
    }),
  };
}

// ---------------------------------------------------------------------------
// IPN and Return URL
// ---------------------------------------------------------------------------

const IPN_ANSWER = Object.freeze({
  CONFIRMED: { RspCode: '00', Message: 'Confirm Success' },
  NOT_FOUND: { RspCode: '01', Message: 'Order not found' },
  ALREADY: { RspCode: '02', Message: 'Order already confirmed' },
  AMOUNT: { RspCode: '04', Message: 'Invalid amount' },
  SIGNATURE: { RspCode: '97', Message: 'Invalid signature' },
  ERROR: { RspCode: '99', Message: 'Unknown error' },
});

/**
 * GET /payments/vnpay/ipn: VNPay's server tells ours how a payment ended.
 * The answer codes are VNPay's: 00 / 02 stop its retries; 01, 04, 97, 99
 * make it call again (up to 10 times, 5 minutes apart).
 */
async function handleIpn(query) {
  try {
    if (!env.VNPAY_ENABLED) return IPN_ANSWER.ERROR;
    const { valid, params } = vnpay.verifyCallback(query);
    if (!valid) return IPN_ANSWER.SIGNATURE;
    if (params.vnp_TmnCode !== env.VNPAY_TMN_CODE) return IPN_ANSWER.NOT_FOUND;
    const payment = await paymentsRepository.findByProviderRef(pool, PAYMENT_PROVIDER.VNPAY, params.vnp_TxnRef);
    if (!payment) return IPN_ANSWER.NOT_FOUND;
    const outcome = vnpay.outcomeOf(params);
    if (outcome.amount !== payment.amount) return IPN_ANSWER.AMOUNT;

    const { result } = await applyGatewayResult(payment.id, { ...outcome, data: params });
    if (result === 'AMOUNT_MISMATCH') return IPN_ANSWER.AMOUNT;
    if (result === 'ALREADY') return IPN_ANSWER.ALREADY;
    if (result === 'NOT_FOUND') return IPN_ANSWER.NOT_FOUND;
    return IPN_ANSWER.CONFIRMED;
  } catch (err) {
    logger.error({ err }, 'VNPay IPN could not be processed');
    return IPN_ANSWER.ERROR;
  }
}

/**
 * GET /payments/vnpay/return: the customer is back from VNPay. The URL only
 * says WHICH attempt (its signature is checked); what happened is asked to
 * VNPay (querydr), as VNPay's guide says not to trust the Return URL.
 */
async function confirmReturn(actor, query) {
  assertEnabled();
  const { valid, params } = vnpay.verifyCallback(query);
  if (!valid) throw new AppError('VALIDATION_ERROR', 'The VNPay answer has an invalid signature.');
  const payment = await paymentsRepository.findByProviderRef(pool, PAYMENT_PROVIDER.VNPAY, params.vnp_TxnRef);
  if (!payment || payment.user_id !== actor.userId) throw new AppError('NOT_FOUND', 'Payment not found.');
  if (payment.status === PAYMENT_STATUS.PENDING) await reconcileAttempt(payment, { reason: params.vnp_ResponseCode });

  const current = await paymentsRepository.findById(pool, payment.id);
  return {
    paymentId: current.id,
    orderId: current.order_id,
    status: current.status,
    // VNPay's reason (24 cancelled, 51 no funds…): recorded, or as the return URL said while still pending.
    responseCode: current.provider_response_code ?? params.vnp_ResponseCode ?? null,
  };
}

// ---------------------------------------------------------------------------
// Background work
// ---------------------------------------------------------------------------

/**
 * Maintenance job (every minute): attempts whose order reached its deadline
 * (or that are 15 minutes old) are asked about. Paid → the order is paid;
 * failed / never started → the attempt is closed and the order expires as
 * usual. VNPay silent → retried each minute, then given up after
 * UNKNOWN_GRACE (money arriving later is refunded).
 */
async function reconcileAttempts() {
  if (!env.VNPAY_ENABLED) return { checked: 0, closed: 0 };
  const attempts = await paymentsRepository.findAttemptsToReconcile(pool, {
    olderThanSeconds: STALE_ATTEMPT_SECONDS,
    limit: VNPAY.RECONCILE_BATCH_SIZE,
  });
  let closed = 0;
  for (const attempt of attempts) {
    const state = await reconcileAttempt(attempt);
    if (state === 'PAID' || state === 'FAILED') {
      closed += 1;
      continue;
    }
    const pastDeadline = attempt.seconds_past_deadline >= 0;
    const giveUp = state === 'UNKNOWN' ? attempt.seconds_past_deadline >= VNPAY.UNKNOWN_GRACE_SECONDS : pastDeadline;
    if (giveUp) {
      await paymentsRepository.cancelAttempt(pool, attempt.id);
      await orders.expireOrder(attempt.order_id);
      closed += 1;
    }
  }
  return { checked: attempts.length, closed };
}

async function failRefund(refundId, message, data = null) {
  await withTransaction(async (client) => {
    await paymentsRepository.failRefund(client, refundId, { message, data });
    await recordAudit(client, {
      context: SYSTEM_CONTEXT,
      action: 'REFUND_FAILED',
      entityType: 'refund',
      entityId: refundId,
      newValue: { message },
    });
  });
}

/**
 * Payments queue: send one refund to VNPay. A temporary failure throws, so
 * BullMQ tries again later (exponential back-off); after the last attempt,
 * or when VNPay refuses for good, the refund is FAILED and an admin can send
 * it again from the order page.
 */
async function processRefund({ refundId }, job = {}) {
  const refund = await withTransaction(async (client) => {
    const row = await paymentsRepository.lockRefund(client, refundId);
    if (!row || row.status !== 'PENDING') return null;
    await paymentsRepository.countRefundAttempt(client, refundId);
    return row;
  });
  if (!refund) return 'skipped';

  let answer;
  try {
    answer = await vnpay.refund({
      txnRef: refund.provider_ref,
      amount: refund.amount,
      transactionNo: refund.provider_transaction_id,
      transactionDate: refund.provider_create_date,
      createdBy: refund.requested_by ?? 'system',
    });
  } catch (err) {
    if (!(err instanceof vnpay.VnpayUnavailableError)) throw err;
    const attempts = job.opts?.attempts ?? VNPAY.REFUND_ATTEMPTS;
    if ((job.attemptsMade ?? 0) + 1 < attempts) throw err; // BullMQ retries later
    await failRefund(refundId, `VNPay không trả lời sau ${attempts} lần gửi (${err.message})`);
    return 'failed';
  }
  if (answer.state === 'DONE') {
    await paymentsRepository.completeRefund(pool, refundId, { providerRefundId: answer.refundTransactionNo, data: answer.data });
    return 'refunded';
  }
  await failRefund(refundId, `VNPay từ chối hoàn tiền (mã ${answer.responseCode}): ${answer.message}`, answer.data);
  return 'refused';
}

/** Emails queue: tell the customer their late payment is being refunded. */
async function sendPaymentReturnedEmail({ paymentId }) {
  const { rows } = await pool.query(
    `SELECT u.email, u.first_name, o.order_code, p.amount
     FROM payments p JOIN orders o ON o.id = p.order_id JOIN users u ON u.id = p.user_id
     WHERE p.id = $1`,
    [paymentId],
  );
  if (!rows[0]) return 'skipped';
  const { email, first_name: firstName, order_code: orderCode, amount } = rows[0];
  await mailer.sendMail({ to: email, ...paymentReturnedEmail({ firstName, orderCode, amount }) });
  return 'sent';
}

module.exports = {
  startPayment,
  handleIpn,
  confirmReturn,
  reconcileAttempts,
  processRefund,
  sendPaymentReturnedEmail,
  applyGatewayResult,
  IPN_ANSWER,
};
