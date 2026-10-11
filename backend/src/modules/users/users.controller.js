const { sendSuccess } = require('../../utils/response');
const usersService = require('./users.service');

async function getMe(req, res) {
  return sendSuccess(res, { user: await usersService.getProfile(req.user.id) });
}

async function updateMe(req, res) {
  return sendSuccess(res, { user: await usersService.updateProfile(req.user.id, req.valid.body) });
}

module.exports = { getMe, updateMe };
