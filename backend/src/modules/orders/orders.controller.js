const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const users = require('../users');
const ordersService = require('./orders.service');

const HTTP_CREATED = 201;

/** The caller as the orders module sees them: whose orders they may touch. */
async function resolveActor(user) {
  const permissions = await users.getPermissionsForRoles(user.roles);
  return { userId: user.id, canManageAll: permissions.includes('order:manage') };
}

async function create(req, res) {
  const order = await ordersService.createOrder(
    requestContext(req),
    await resolveActor(req.user),
    req.valid.params.id,
    req.valid.body,
  );
  return sendSuccess(res, { order }, { status: HTTP_CREATED });
}

async function list(req, res) {
  const { orders, meta } = await ordersService.listOrders(await resolveActor(req.user), req.valid.query);
  return sendSuccess(res, { orders }, { meta });
}

async function get(req, res) {
  return sendSuccess(res, { order: await ordersService.getOrder(await resolveActor(req.user), req.valid.params.id) });
}

async function cancel(req, res) {
  const order = await ordersService.cancelOrder(requestContext(req), await resolveActor(req.user), req.valid.params.id);
  return sendSuccess(res, { order });
}

module.exports = { create, list, get, cancel };
