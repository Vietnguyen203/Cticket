const AppError = require('../../utils/AppError');
const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const { getProfile } = require('../users');
const authService = require('./auth.service');
const twoFactor = require('./two-factor.service');
const { verifyAccessToken } = require('./auth.tokens');
const schemas = require('./auth.schemas');
const cookie = require('./refresh-cookie');
const { TWO_FACTOR } = require('../../config/constants');

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

/**
 * Where the refresh token comes from: the body, or (web app) the httpOnly cookie.
 * @returns {string|undefined}
 */
function refreshTokenOf(req) {
  if (req.valid.body.refreshToken) return req.valid.body.refreshToken;
  const fromCookie = cookie.readRefreshCookie(req);
  return schemas.refreshToken.safeParse(fromCookie).success ? fromCookie : undefined;
}

/**
 * Cookie mode: the refresh token goes into the cookie and is left out of the body (a script could read the body).
 * `deviceToken`: "Ghi nhớ đăng nhập" after a two-factor step, the device cookie (30 days).
 */
function sendTokens(req, res, tokens, { deviceToken = null } = {}) {
  if (!cookie.usesCookie(req)) return sendSuccess(res, tokens);
  const { refreshToken, ...rest } = tokens;
  cookie.setRefreshCookie(res, refreshToken);
  if (deviceToken) cookie.setDeviceCookie(res, deviceToken, TWO_FACTOR.TRUSTED_DEVICE_DAYS);
  return sendSuccess(res, rest);
}

// The request context (IP, user agent) is stored with each refresh token so
// users can later see their active sessions.
async function login(req, res) {
  const result = await authService.login(req.valid.body, requestContext(req), { deviceToken: cookie.readDeviceCookie(req) });
  // Two-factor (Phase 15): no session yet, only the mfaToken for step 2.
  if (result.mfaToken) return sendSuccess(res, result);
  return sendTokens(req, res, result);
}

/** Login step 2: a code (or recovery code) → the session. */
async function verifyLoginTwoFactor(req, res) {
  const { session, deviceToken } = await twoFactor.verifyLogin(req.valid.body, requestContext(req));
  return sendTokens(req, res, session, { deviceToken });
}

/** An admin without two-factor: the secret to scan. */
async function startLoginTwoFactorSetup(req, res) {
  return sendSuccess(res, { setup: await twoFactor.startLoginSetup(req.valid.body) });
}

/** The first code: two-factor on, the recovery codes (shown once) and the session. */
async function confirmLoginTwoFactorSetup(req, res) {
  const { session, recoveryCodes } = await twoFactor.confirmLoginSetup(req.valid.body, requestContext(req));
  return sendTokens(req, res, { ...session, recoveryCodes });
}

async function refresh(req, res) {
  const refreshToken = refreshTokenOf(req);
  if (!refreshToken) {
    // Same answer as before for API clients; a browser without a cookie simply has no session.
    if (cookie.usesCookie(req)) throw new AppError('INVALID_REFRESH_TOKEN');
    throw new AppError('VALIDATION_ERROR', undefined, { details: [{ field: 'body.refreshToken', message: 'Required' }] });
  }
  try {
    return sendTokens(req, res, await authService.refresh({ refreshToken }, requestContext(req)));
  } catch (err) {
    // A dead cookie would otherwise be sent again on every page load.
    if (cookie.usesCookie(req)) cookie.clearRefreshCookie(res);
    throw err;
  }
}

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

/** The access token sent with a logout, if any and still valid; logout itself never fails because of it. */
function accessTokenOf(req) {
  const match = BEARER_PATTERN.exec(req.get('authorization') ?? '');
  if (!match) return null;
  try {
    return verifyAccessToken(match[1]);
  } catch {
    return null; // expired or invalid: nothing left to revoke
  }
}

async function logout(req, res) {
  const refreshToken = refreshTokenOf(req);
  if (!refreshToken && !cookie.usesCookie(req)) {
    throw new AppError('VALIDATION_ERROR', undefined, { details: [{ field: 'body.refreshToken', message: 'Required' }] });
  }
  if (cookie.usesCookie(req)) cookie.clearRefreshCookie(res);
  // Idempotent: a browser whose cookie is already gone still gets its access token revoked.
  await authService.logout({ refreshToken }, accessTokenOf(req));
  return res.status(HTTP_NO_CONTENT).end();
}

async function me(req, res) {
  return sendSuccess(res, { user: await getProfile(req.user.id) });
}

module.exports = {
  register,
  requestOtp,
  verifyOtp,
  login,
  verifyLoginTwoFactor,
  startLoginTwoFactorSetup,
  confirmLoginTwoFactorSetup,
  refresh,
  logout,
  me,
  sendTokens,
};
