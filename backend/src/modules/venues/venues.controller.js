const { sendSuccess } = require('../../utils/response');
const venuesService = require('./venues.service');
const { viewerOf } = require('./viewer');

const HTTP_CREATED = 201;

async function list(req, res) {
  const { venues, meta } = await venuesService.listVenues(req.valid.query, await viewerOf(req));
  return sendSuccess(res, { venues }, { meta });
}

async function get(req, res) {
  const venue = await venuesService.getVenue(req.valid.params.id, await viewerOf(req));
  return sendSuccess(res, { venue });
}

async function create(req, res) {
  const venue = await venuesService.createVenue(req.valid.body, await viewerOf(req));
  return sendSuccess(res, { venue }, { status: HTTP_CREATED });
}

async function update(req, res) {
  const venue = await venuesService.updateVenue(req.valid.params.id, req.valid.body);
  return sendSuccess(res, { venue });
}

module.exports = { list, get, create, update };
