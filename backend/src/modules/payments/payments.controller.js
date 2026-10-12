const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const users = require('../users');
const paymentsService = require('./payments.service');

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

module.exports = { pay, get, refund };
