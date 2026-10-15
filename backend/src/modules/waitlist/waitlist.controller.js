const { sendSuccess } = require('../../utils/response');
const waitlistService = require('./waitlist.service');

const HTTP_CREATED = 201;

async function join(req, res) {
  const entry = await waitlistService.join({ userId: req.user.id }, req.valid.params.id, req.valid.body);
  return sendSuccess(res, { entry }, { status: HTTP_CREATED });
}

async function listMine(req, res) {
  return sendSuccess(res, { entries: await waitlistService.listMine(req.user.id) });
}

async function leave(req, res) {
  await waitlistService.leave(req.user.id, req.valid.params.id);
  return sendSuccess(res, { left: true });
}

module.exports = { join, listMine, leave };
