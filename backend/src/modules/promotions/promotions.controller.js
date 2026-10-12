const { sendSuccess } = require('../../utils/response');
const orders = require('../orders');
const promotionsService = require('./promotions.service');

const HTTP_CREATED = 201;

/** PRO-01: preview a code on one of my orders (the order belongs to the orders module). */
async function validatePromotion(req, res) {
  return sendSuccess(res, { preview: await orders.previewPromotion({ userId: req.user.id }, req.valid.body) });
}

async function list(req, res) {
  const { promotions, meta } = await promotionsService.listPromotions(req.valid.query);
  return sendSuccess(res, { promotions }, { meta });
}

async function create(req, res) {
  return sendSuccess(res, { promotion: await promotionsService.createPromotion(req.valid.body) }, { status: HTTP_CREATED });
}

async function update(req, res) {
  return sendSuccess(res, { promotion: await promotionsService.updatePromotion(req.valid.params.id, req.valid.body) });
}

module.exports = { validatePromotion, list, create, update };
