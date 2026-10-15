const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const reviewsService = require('./reviews.service');

async function listForEvent(req, res) {
  const { meta, ...data } = await reviewsService.listForEvent(req.user, req.valid.params.idOrSlug, req.valid.query);
  return sendSuccess(res, data, { meta });
}

async function getMine(req, res) {
  return sendSuccess(res, await reviewsService.getMine(req.user.id, req.valid.params.id));
}

async function saveMine(req, res) {
  return sendSuccess(res, { review: await reviewsService.saveMine(requestContext(req), req.user.id, req.valid.params.id, req.valid.body) });
}

async function deleteMine(req, res) {
  await reviewsService.deleteMine(req.user.id, req.valid.params.id);
  return sendSuccess(res, { deleted: true });
}

async function reply(req, res) {
  return sendSuccess(res, { review: await reviewsService.setReply(requestContext(req), req.user, req.valid.params.id, req.valid.body.reply) });
}

async function deleteReply(req, res) {
  return sendSuccess(res, { review: await reviewsService.setReply(requestContext(req), req.user, req.valid.params.id, null) });
}

async function listForAdmin(req, res) {
  const { reviews, meta } = await reviewsService.listForAdmin(req.valid.query);
  return sendSuccess(res, { reviews }, { meta });
}

async function hide(req, res) {
  return sendSuccess(res, { review: await reviewsService.moderate(requestContext(req), req.valid.params.id, { hide: true, reason: req.valid.body.reason }) });
}

async function unhide(req, res) {
  return sendSuccess(res, { review: await reviewsService.moderate(requestContext(req), req.valid.params.id, { hide: false }) });
}

module.exports = { listForEvent, getMine, saveMine, deleteMine, reply, deleteReply, listForAdmin, hide, unhide };
