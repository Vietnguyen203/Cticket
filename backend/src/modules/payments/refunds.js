const { PAYMENT_PROVIDER } = require('../../config/constants');
const { QUEUE, enqueueAfterCommit } = require('../../queue/queues');
const paymentsRepository = require('./payments.repository');

/**
 * Start the refund of a payment, in the caller's transaction (its order is
 * locked). Shared by event / show cancellations and late VNPay money.
 *
 * - SIMULATOR: done at once (nothing to call).
 * - VNPAY (Phase 17): a PENDING refund that the payments queue sends to VNPay
 *   once this commits; never an outside call while row locks are held.
 * @returns {Promise<string>} the refund id
 */
async function startRefund(client, { payment, orderId, reason, requestedBy, amount = payment.amount }) {
  if (payment.provider !== PAYMENT_PROVIDER.VNPAY) {
    return paymentsRepository.insertRefund(client, { paymentId: payment.id, orderId, amount, reason });
  }
  const refundId = await paymentsRepository.insertPendingRefund(client, {
    paymentId: payment.id,
    orderId,
    amount,
    reason,
    requestedBy,
  });
  enqueueRefund(client, refundId);
  return refundId;
}

/** Send (or send again) a VNPay refund once the caller's transaction commits. */
function enqueueRefund(client, refundId, { again = false } = {}) {
  // A retry needs a new job id: the finished job keeps its id for a day.
  const jobId = again ? `vnpay-refund-${refundId}-${Date.now()}` : `vnpay-refund-${refundId}`;
  enqueueAfterCommit(client, QUEUE.PAYMENTS, 'vnpay-refund', { refundId }, { jobId });
}

module.exports = { startRefund, enqueueRefund };
