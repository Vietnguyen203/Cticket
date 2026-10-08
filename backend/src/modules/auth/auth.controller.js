const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const { getProfile } = require('../users');
const authService = require('./auth.service');

const HTTP_CREATED = 201;
const HTTP_ACCEPTED = 202;
const HTTP_NO_CONTENT = 204;

async function register(req, res) {
  const user = await authService.register(req.valid.body);
  return sendSuccess(res, { user }, { status: HTTP_CREATED });
}

async function requestOtp(req, res) {
  await authService.requestOtp(req.valid.body);
  return sendSuccess(
    res,
    { message: 'If the account is eligible, a verification code has been sent.' },
    { status: HTTP_ACCEPTED },
  );
}

async function verifyOtp(req, res) {
  await authService.verifyOtp(req.valid.body);
  return sendSuccess(res, { purpose: req.valid.body.purpose, verified: true });
}

// The request context (IP, user agent) is stored with each refresh token so
// users can later see their active sessions.
async function login(req, res) {
  return sendSuccess(res, await authService.login(req.valid.body, requestContext(req)));
}

async function refresh(req, res) {
  return sendSuccess(res, await authService.refresh(req.valid.body, requestContext(req)));
}

async function logout(req, res) {
  await authService.logout(req.valid.body);
  return res.status(HTTP_NO_CONTENT).end();
}

async function me(req, res) {
  return sendSuccess(res, { user: await getProfile(req.user.id) });
}

module.exports = { register, requestOtp, verifyOtp, login, refresh, logout, me };
