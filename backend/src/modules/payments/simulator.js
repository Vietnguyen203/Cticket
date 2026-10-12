const { randomUUID } = require('node:crypto');
const { PAYMENT_STATUS } = require('../../config/constants');

/**
 * The payment provider used until a real gateway (VNPay, MoMo) is added.
 * It answers immediately with the outcome the client asked for, so tests and
 * Postman can exercise both paths (PAY-01). No money moves, which is also
 * why it may run inside the order's transaction; a real gateway is called
 * outside it and reports back through a webhook.
 *
 * @param {{ amount: number, simulate: 'SUCCESS' | 'FAILED' }} request
 */
function charge({ simulate }) {
  if (simulate === PAYMENT_STATUS.FAILED) {
    return {
      status: PAYMENT_STATUS.FAILED,
      providerTransactionId: `SIM-${randomUUID()}`,
      failureCode: 'CARD_DECLINED',
      failureMessage: 'The card was declined (simulated).',
    };
  }
  return { status: PAYMENT_STATUS.SUCCESS, providerTransactionId: `SIM-${randomUUID()}`, failureCode: null, failureMessage: null };
}

module.exports = { charge };
