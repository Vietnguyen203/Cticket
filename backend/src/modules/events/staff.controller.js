const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const staffService = require('./staff.service');
const { resolveActor } = require('./event-access');

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;

async function assign(req, res) {
  const staff = await staffService.assignStaff(
    requestContext(req),
    await resolveActor(req.user),
    req.valid.params.id,
    req.valid.body,
  );
  return sendSuccess(res, { staff }, { status: HTTP_CREATED });
}

async function list(req, res) {
  return sendSuccess(res, { staff: await staffService.listStaff(await resolveActor(req.user), req.valid.params.id) });
}

async function remove(req, res) {
  await staffService.removeStaff(requestContext(req), await resolveActor(req.user), req.valid.params.id, req.valid.params.userId);
  return res.status(HTTP_NO_CONTENT).end();
}

async function myEvents(req, res) {
  return sendSuccess(res, { events: await staffService.listMyEvents(req.user) });
}

module.exports = { assign, list, remove, myEvents };
