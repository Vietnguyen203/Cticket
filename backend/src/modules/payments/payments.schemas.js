const { z } = require('zod');
const { PAYMENT_STATUS } = require('../../config/constants');

const idParams = z.object({ id: z.uuid() });

const pay = z.object({
  orderId: z.uuid(),
  // Simulated provider only: which outcome to produce (default SUCCESS).
  simulate: z.enum([PAYMENT_STATUS.SUCCESS, PAYMENT_STATUS.FAILED]).default(PAYMENT_STATUS.SUCCESS),
});

const refund = z.object({ reason: z.string().trim().min(3).max(500) });

module.exports = { idParams, pay, refund };
