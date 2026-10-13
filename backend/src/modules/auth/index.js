/**
 * Public API of the auth module for other code (middleware, other modules).
 * Routes are mounted from src/routes.js and are deliberately not exported
 * here, to avoid a require cycle (routes → authenticate → this file).
 */
const { verifyAccessToken } = require('./auth.tokens');
const { isRevoked, revokeAllTokensOfUser } = require('./denylist');
const { sendOtpEmail } = require('./otp.service');
const { revokeAllRefreshTokensOfUser } = require('./auth.repository');

module.exports = {
  verifyAccessToken,
  isRevoked,
  revokeAllTokensOfUser,
  /** Every refresh token of the user (in the caller's transaction): no new access tokens. */
  revokeSessionsOfUser: revokeAllRefreshTokensOfUser,
  sendOtpEmail,
};
