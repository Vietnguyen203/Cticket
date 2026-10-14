const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const eventsService = require('./events.service');
const { resolveActor } = require('./event-access');

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;

async function list(req, res) {
  const { events, meta } = await eventsService.listEvents(await resolveActor(req.user), req.valid.query);
  return sendSuccess(res, { events }, { meta });
}

async function get(req, res) {
  const event = await eventsService.getEvent(await resolveActor(req.user), req.valid.params.idOrSlug);
  return sendSuccess(res, { event });
}

async function create(req, res) {
  const event = await eventsService.createEvent(requestContext(req), await resolveActor(req.user), req.valid.body);
  return sendSuccess(res, { event }, { status: HTTP_CREATED });
}

async function update(req, res) {
  const event = await eventsService.updateEvent(
    requestContext(req),
    await resolveActor(req.user),
    req.valid.params.id,
    req.valid.body,
  );
  return sendSuccess(res, { event });
}

async function remove(req, res) {
  await eventsService.deleteEvent(requestContext(req), await resolveActor(req.user), req.valid.params.id, req.valid.body ?? {});
  return res.status(HTTP_NO_CONTENT).end();
}

async function deletionSummary(req, res) {
  return sendSuccess(res, { summary: await eventsService.deletionSummary(await resolveActor(req.user), req.valid.params.id) });
}

async function changeStatus(req, res) {
  const event = await eventsService.changeStatus(
    requestContext(req),
    await resolveActor(req.user),
    req.valid.params.id,
    req.valid.body,
  );
  return sendSuccess(res, { event });
}

module.exports = { list, get, create, update, remove, deletionSummary, changeStatus };
