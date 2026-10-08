const { sendSuccess } = require('../../utils/response');
const { getPermissionsForRoles } = require('../users');
const venuesService = require('./venues.service');

const HTTP_CREATED = 201;
const MANAGE_PERMISSION = 'venue:manage';

/** Optional login: managers additionally see inactive venues. */
async function canManageVenues(req) {
  if (!req.user) return false;
  return (await getPermissionsForRoles(req.user.roles)).includes(MANAGE_PERMISSION);
}

async function list(req, res) {
  const { venues, meta } = await venuesService.listVenues(req.valid.query, { canManage: await canManageVenues(req) });
  return sendSuccess(res, { venues }, { meta });
}

async function get(req, res) {
  const venue = await venuesService.getVenue(req.valid.params.id, { canManage: await canManageVenues(req) });
  return sendSuccess(res, { venue });
}

async function create(req, res) {
  const venue = await venuesService.createVenue(req.valid.body);
  return sendSuccess(res, { venue }, { status: HTTP_CREATED });
}

async function update(req, res) {
  const venue = await venuesService.updateVenue(req.valid.params.id, req.valid.body);
  return sendSuccess(res, { venue });
}

module.exports = { list, get, create, update };
