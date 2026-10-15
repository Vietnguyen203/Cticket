const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const users = require('../users');
const paymentsService = require('./payments.service');
const vnpayService = require('./vnpay.service');
const cancellation = require('./cancellation.service');

const HTTP_CREATED = 201;

async function resolveActor(user) {
  const permissions = await users.getPermissionsForRoles(user.roles);
  return { userId: user.id, canManagePayments: permissions.includes('payment:manage') };
}

async function pay(req, res) {
  const { payment, replayed } = await paymentsService.pay(
    requestContext(req),
    await resolveActor(req.user),
    req.valid.body,
    req.idempotencyKey,
  );
  // A replay gets exactly the first answer, flagged so clients and logs can tell.
  if (replayed) res.set('Idempotent-Replayed', 'true');
  return sendSuccess(res, { payment }, { status: HTTP_CREATED });
}

async function get(req, res) {
  return sendSuccess(res, { payment: await paymentsService.getPayment(await resolveActor(req.user), req.valid.params.id) });
}

async function refund(req, res) {
  const payment = await paymentsService.refundPayment(requestContext(req), req.valid.params.id, req.valid.body);
  return sendSuccess(res, { payment });
}

// --- Phase 17 ------------------------------------------------------------------

function methods(req, res) {
  return sendSuccess(res, { methods: paymentsService.paymentMethods() });
}

/** A new VNPay attempt: the web sends the customer to paymentUrl. */
async function startVnpay(req, res) {
  const result = await vnpayService.startPayment(await resolveActor(req.user), req.valid.body, { ip: req.ip });
  return sendSuccess(res, result, { status: HTTP_CREATED });
}

/** VNPay's server-to-server call: answered in VNPay's format, not the API envelope. */
async function vnpayIpn(req, res) {
  return res.status(200).json(await vnpayService.handleIpn(req.query));
}

async function vnpayReturn(req, res) {
  return sendSuccess(res, { payment: await vnpayService.confirmReturn(await resolveActor(req.user), req.valid.query) });
}

async function retryRefund(req, res) {
  return sendSuccess(res, { refund: await paymentsService.retryRefund(requestContext(req), req.valid.params.id) });
}

// --- Phase 18.3 ------------------------------------------------------------------

async function previewCancellation(req, res) {
  return sendSuccess(res, { cancellation: await cancellation.previewCancellation(await resolveActor(req.user), req.valid.params.id) });
}

async function cancelOrder(req, res) {
  const result = await cancellation.cancelOrder(
    requestContext(req),
    await resolveActor(req.user),
    req.valid.params.id,
    req.valid.body,
    paymentsService.refundLockedOrder,
  );
  return sendSuccess(res, { cancellation: result });
}

module.exports = {
  pay,
  get,
  refund,
  methods,
  startVnpay,
  vnpayIpn,
  vnpayReturn,
  retryRefund,
  previewCancellation,
  cancelOrder,
};
