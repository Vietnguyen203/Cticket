const { sendSuccess } = require('../../utils/response');
const layoutService = require('./venue-layout.service');
const { viewerOf } = require('./viewer');

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;

async function createZone(req, res) {
  const zone = await layoutService.createZone(req.valid.params.venueId, req.valid.body, await viewerOf(req));
  return sendSuccess(res, { zone }, { status: HTTP_CREATED });
}

async function updateZone(req, res) {
  return sendSuccess(res, { zone: await layoutService.updateZone(req.valid.params.id, req.valid.body) });
}

async function createSeats(req, res) {
  const result = await layoutService.createSeats(req.valid.params.id, req.valid.body, await viewerOf(req));
  return sendSuccess(res, result, { status: HTTP_CREATED });
}

async function deleteSeat(req, res) {
  await layoutService.deleteSeat(req.valid.params.id);
  return res.status(HTTP_NO_CONTENT).end();
}

async function getLayout(req, res) {
  const layout = await layoutService.getLayout(req.valid.params.id, await viewerOf(req));
  return sendSuccess(res, layout);
}

module.exports = { createZone, updateZone, createSeats, deleteSeat, getLayout };
