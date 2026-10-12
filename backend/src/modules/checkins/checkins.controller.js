const { sendSuccess } = require('../../utils/response');
const checkinsService = require('./checkins.service');

const HTTP_CREATED = 201;

async function create(req, res) {
  return sendSuccess(res, await checkinsService.checkIn(req.user, req.valid.body), { status: HTTP_CREATED });
}

async function list(req, res) {
  const { checkIns, meta } = await checkinsService.listCheckIns(req.user, req.valid.params.id, req.valid.query);
  return sendSuccess(res, { checkIns }, { meta });
}

async function stats(req, res) {
  return sendSuccess(res, { stats: await checkinsService.getStats(req.user, req.valid.params.id) });
}

module.exports = { create, list, stats };
