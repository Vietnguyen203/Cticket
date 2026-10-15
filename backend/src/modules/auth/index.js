/**
 * Public API of the auth module for other code (middleware, other modules).
 * Routes are mounted from src/routes.js and are deliberately not exported
 * here, to avoid a require cycle (routes → authenticate → this file).
 */
const { verifyAccessToken } = require('./auth.tokens');
const { isRevoked, revokeAllTokensOfUser } = require('./denylist');
const { sendOtpEmail } = require('./otp.service');
const { revokeAllRefreshTokensOfUser } = require('./auth.repository');
const twoFactor = require('./two-factor.service');
const loginGuard = require('./login-guard');
const mailer = require('../../mail/mailer');
const { loginLockedEmail } = require('../../mail/templates');

module.exports = {
  verifyAccessToken,
  isRevoked,
  revokeAllTokensOfUser,
  /** Every refresh token of the user (in the caller's transaction): no new access tokens. */
  revokeSessionsOfUser: revokeAllRefreshTokensOfUser,
  sendOtpEmail,
  // Phase 15
  sendTwoFactorAlert: twoFactor.sendAlertEmail,
  /** Two-factor off for a user who lost their phone, in the caller's transaction. */
  resetTwoFactor: twoFactor.resetTwoFactor,
  enableKnownTotpSecret: twoFactor.enableKnownSecret,
  /** Queue the "two-factor was reset" email for a user row (email, first_name). */
  alertTwoFactorReset: (user) => twoFactor.queueAlert(user, twoFactor.ALERT.RESET),
  // Phase 18.1
  clearLoginLock: loginGuard.clear,
  loginLockedUntilOf: loginGuard.lockedUntilOf,
  purgeLoginAttempts: loginGuard.purgeOld,
  /** Emails queue: "your account was locked after wrong passwords". */
  sendLoginLockedEmail: ({ to, firstName, minutes }) => mailer.sendMail({ to, ...loginLockedEmail({ firstName, minutes }) }),
};
