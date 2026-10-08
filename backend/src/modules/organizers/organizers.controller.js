const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const organizersService = require('./organizers.service');

const HTTP_CREATED = 201;

async function apply(req, res) {
  const organizer = await organizersService.apply(requestContext(req), req.valid.body);
  return sendSuccess(res, { organizer }, { status: HTTP_CREATED });
}

async function getMine(req, res) {
  return sendSuccess(res, { organizer: await organizersService.getMyOrganizer(req.user.id) });
}

async function list(req, res) {
  const { organizers, meta } = await organizersService.listOrganizers(req.valid.query);
  return sendSuccess(res, { organizers }, { meta });
}

async function changeStatus(req, res) {
  const organizer = await organizersService.changeStatus(requestContext(req), req.valid.params.id, req.valid.body);
  return sendSuccess(res, { organizer });
}

module.exports = { apply, getMine, list, changeStatus };
