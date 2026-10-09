const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const ticketTypesService = require('./ticket-types.service');
const inventoryService = require('./inventory.service');
const { resolveActor } = require('./event-access');

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;

async function listTicketTypes(req, res) {
  const ticketTypes = await ticketTypesService.listTicketTypes(await resolveActor(req.user), req.valid.params.id);
  return sendSuccess(res, { ticketTypes });
}

async function createTicketType(req, res) {
  const ticketType = await ticketTypesService.createTicketType(
    requestContext(req),
    await resolveActor(req.user),
    req.valid.params.id,
    req.valid.body,
  );
  return sendSuccess(res, { ticketType }, { status: HTTP_CREATED });
}

async function updateTicketType(req, res) {
  const ticketType = await ticketTypesService.updateTicketType(
    requestContext(req),
    await resolveActor(req.user),
    req.valid.params.id,
    req.valid.body,
  );
  return sendSuccess(res, { ticketType });
}

async function deleteTicketType(req, res) {
  await ticketTypesService.deleteTicketType(requestContext(req), await resolveActor(req.user), req.valid.params.id);
  return res.status(HTTP_NO_CONTENT).end();
}

async function getSeatPlan(req, res) {
  return sendSuccess(res, await ticketTypesService.getSeatPlan(await resolveActor(req.user), req.valid.params.id));
}

async function replaceSeatPlan(req, res) {
  const plan = await ticketTypesService.replaceSeatPlan(
    requestContext(req),
    await resolveActor(req.user),
    req.valid.params.id,
    req.valid.body,
  );
  return sendSuccess(res, plan);
}

async function getAvailability(req, res) {
  return sendSuccess(res, await inventoryService.getAvailability(await resolveActor(req.user), req.valid.params.id));
}

async function getSeatMap(req, res) {
  return sendSuccess(res, await inventoryService.getSeatMap(await resolveActor(req.user), req.valid.params.id));
}

async function changeBlocks(req, res) {
  const result = await inventoryService.changeBlocks(
    requestContext(req),
    await resolveActor(req.user),
    req.valid.params.id,
    req.valid.body,
  );
  return sendSuccess(res, result);
}

async function regenerateInventory(req, res) {
  const created = await inventoryService.regenerateInventory(
    requestContext(req),
    await resolveActor(req.user),
    req.valid.params.id,
  );
  return sendSuccess(res, { created });
}

module.exports = {
  listTicketTypes,
  createTicketType,
  updateTicketType,
  deleteTicketType,
  getSeatPlan,
  replaceSeatPlan,
  getAvailability,
  getSeatMap,
  changeBlocks,
  regenerateInventory,
};
