const { z } = require('zod');
const { PAYMENT_STATUS } = require('../../config/constants');

const idParams = z.object({ id: z.uuid() });

const pay = z.object({
  orderId: z.uuid(),
  // Simulated provider only: which outcome to produce (default SUCCESS).
  simulate: z.enum([PAYMENT_STATUS.SUCCESS, PAYMENT_STATUS.FAILED]).default(PAYMENT_STATUS.SUCCESS),
});

const refund = z.object({ reason: z.string().trim().min(3).max(500) });

// Phase 17
const startVnpay = z.object({ orderId: z.uuid() });
// The query string VNPay put on the Return URL: vnp_* strings, checked by signature in the service.
const vnpayCallback = z
  .record(z.string().regex(/^vnp_\w{1,40}$/), z.string().max(1000))
  .refine((query) => Object.keys(query).length <= 40, { message: 'too many parameters' });

// Phase 18.3: the refund the customer saw and accepted.
const cancelOrder = z.object({ refundAmount: z.number().int().min(0) });

module.exports = {
  cancelOrder, idParams, pay, refund, startVnpay, vnpayCallback };
