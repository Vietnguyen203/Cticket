const { sendSuccess } = require('../../utils/response');
const service = require('./purchase-queue.service');

async function join(req, res) {
  return sendSuccess(res, { queue: await service.join(req.user.id, req.valid.params.id) });
}

async function status(req, res) {
  return sendSuccess(res, { queue: await service.status(req.user.id, req.valid.params.id) });
}

/** "Vào ngay": checked again now; in at once if there is room. */
async function tryNow(req, res) {
  return sendSuccess(res, { queue: await service.tryNow(req.user.id, req.valid.params.id) });
}

async function leave(req, res) {
  await service.leave(req.user.id, req.valid.params.id);
  return sendSuccess(res, { left: true });
}

async function stats(req, res) {
  return sendSuccess(res, { queue: await service.stats(req.user, req.valid.params.id) });
}

module.exports = { join, status, tryNow, leave, stats };
