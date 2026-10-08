const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const schedulesService = require('./schedules.service');
const { resolveActor } = require('./event-access');

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;

async function list(req, res) {
  const schedules = await schedulesService.listSchedules(await resolveActor(req.user), req.valid.params.eventId);
  return sendSuccess(res, { schedules });
}

async function create(req, res) {
  const schedule = await schedulesService.createSchedule(
    requestContext(req),
    await resolveActor(req.user),
    req.valid.params.eventId,
    req.valid.body,
  );
  return sendSuccess(res, { schedule }, { status: HTTP_CREATED });
}

async function update(req, res) {
  const schedule = await schedulesService.updateSchedule(
    requestContext(req),
    await resolveActor(req.user),
    req.valid.params.id,
    req.valid.body,
  );
  return sendSuccess(res, { schedule });
}

async function remove(req, res) {
  await schedulesService.deleteSchedule(requestContext(req), await resolveActor(req.user), req.valid.params.id);
  return res.status(HTTP_NO_CONTENT).end();
}

module.exports = { list, create, update, remove };
