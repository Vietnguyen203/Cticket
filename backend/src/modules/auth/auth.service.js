const bcrypt = require('bcrypt');
const env = require('../../config/env');
const { ROLES, USER_STATUS, OTP_PURPOSE, TWO_FACTOR } = require('../../config/constants');
const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const users = require('../users');
const authRepository = require('./auth.repository');
const tokens = require('./auth.tokens');
const otpService = require('./otp.service');
const denylist = require('./denylist');
const sessions = require('./sessions');
const twoFactor = require('./two-factor.service');
const loginGuard = require('./login-guard');

/** Account status a user must have to receive / use a code for each purpose. */
const REQUIRED_STATUS = {
  [OTP_PURPOSE.EMAIL_VERIFICATION]: USER_STATUS.PENDING_VERIFICATION,
  [OTP_PURPOSE.PASSWORD_RESET]: USER_STATUS.ACTIVE,
};

function hashPassword(password) {
  return bcrypt.hash(password, env.BCRYPT_COST);
}

/**
 * Hash compared against when the email does not exist, so a login for an
 * unknown email takes as long as one with a wrong password. Without it, the
 * response time would reveal which emails are registered.
 */
let dummyHashPromise;
function getDummyHash() {
  dummyHashPromise ??= hashPassword('timing-equalizer-not-a-real-password');
  return dummyHashPromise;
}

// ---------------------------------------------------------------------------
// Registration and OTP
// ---------------------------------------------------------------------------

async function register({ email, password, firstName, lastName, phone }) {
  // bcrypt is deliberately slow (~250 ms). Hash BEFORE opening the transaction
  // so we never hold a database connection while hashing.
  const passwordHash = await hashPassword(password);

  // User and role are created together or not at all. A duplicate email is
  // rejected by the UNIQUE index (→ 409 EMAIL_TAKEN), even when two
  // registrations race each other.
  const user = await withTransaction(async (client) => {
    const created = await users.insertUser(client, {
      email,
      passwordHash,
      firstName,
      lastName,
      phone,
      status: USER_STATUS.PENDING_VERIFICATION,
    });
    await users.addRole(client, created.id, ROLES.CUSTOMER);
    return created;
  });

  // The code lives in Redis, so it is created after COMMIT. If Redis fails
  // here the account still exists and "resend code" fixes it.
  try {
    const code = await otpService.issueOtp(user.id, OTP_PURPOSE.EMAIL_VERIFICATION);
    if (code) await otpService.queueOtpEmail(user, OTP_PURPOSE.EMAIL_VERIFICATION, code);
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Account created but the verification code could not be issued');
  }
  return users.toPublicUser(user, [ROLES.CUSTOMER]);
}

/**
 * Send (or re-send) a code. Never reveals whether the email exists, whether
 * the account is eligible, or whether a limit was hit: the caller always
 * gets the same 202 response. The resend limits are enforced atomically in
 * Redis, so no row lock is needed.
 */
async function requestOtp({ email, purpose }) {
  const user = await users.findByEmail(pool, email);
  if (!user || user.status !== REQUIRED_STATUS[purpose]) {
    return;
  }
  const code = await otpService.issueOtp(user.id, purpose);
  if (code) {
    await otpService.queueOtpEmail(user, purpose, code);
  }
}

/**
 * EMAIL_VERIFICATION: activates the account.
 * PASSWORD_RESET: sets the new password and logs the user out everywhere.
 *
 * The code is used up in Redis FIRST, then PostgreSQL is updated. If the
 * database step fails, the code is gone and the user asks for a new one;
 * an account is never activated without a correct code.
 */
async function verifyOtp({ email, purpose, otp, newPassword }) {
  const user = await users.findByEmail(pool, email);
  if (!user || user.status !== REQUIRED_STATUS[purpose] || !(await otpService.consumeOtp(user.id, purpose, otp))) {
    throw new AppError('INVALID_OTP');
  }

  const newPasswordHash = purpose === OTP_PURPOSE.PASSWORD_RESET ? await hashPassword(newPassword) : null;
  await withTransaction(async (client) => {
    if (purpose === OTP_PURPOSE.EMAIL_VERIFICATION) {
      await users.markEmailVerified(client, user.id);
    } else {
      await users.updatePasswordHash(client, user.id, newPasswordHash);
      await authRepository.revokeAllRefreshTokensOfUser(client, user.id);
    }
  });
  if (purpose === OTP_PURPOSE.PASSWORD_RESET) {
    // Access tokens already handed out stop working now, not in 15 minutes.
    await denylist.revokeAllTokensOfUser(user.id);
    // Phase 18.1: whoever reads this mailbox may sign in again at once.
    await loginGuard.clear(pool, user.email);
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Step 1 of a login. With two-factor (Phase 15) the answer is not a session
 * yet but an mfaToken for step 2: { mfaRequired } (enter a code) or
 * { mfaSetupRequired } (a role that requires two-factor, not set up yet).
 */
async function login({ email, password, remember }, meta) {
  // Phase 18.1: a locked email is refused before its password is even checked.
  await loginGuard.assertNotLocked(pool, email);
  const user = await users.findByEmail(pool, email);
  const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? (await getDummyHash()));

  // Same error for "no such email" and "wrong password" (and the same lock).
  if (!user || !passwordMatches) {
    const { locked, lockSeconds } = await loginGuard.failAndMaybeAlert(pool, email, user);
    if (locked) throw new AppError('LOGIN_LOCKED', undefined, { details: { retryAfterSeconds: lockSeconds } });
    throw new AppError('INVALID_CREDENTIALS');
  }
  // Status is only revealed to someone who knows the password.
  if (user.status === USER_STATUS.PENDING_VERIFICATION) {
    throw new AppError('EMAIL_NOT_VERIFIED');
  }
  if (user.status !== USER_STATUS.ACTIVE) {
    throw new AppError('ACCOUNT_DISABLED');
  }

  const roles = await users.findRoleCodes(pool, user.id);
  const challenge = await twoFactor.loginChallenge(pool, user, roles);
  if (challenge) {
    return {
      [challenge === 'verify' ? 'mfaRequired' : 'mfaSetupRequired']: true,
      mfaToken: tokens.signMfaToken({ userId: user.id, purpose: challenge, remember }),
      expiresIn: TWO_FACTOR.MFA_TOKEN_TTL_SECONDS,
    };
  }
  // Only a complete sign-in ends a streak: a right password alone does not
  // (wrong two-factor codes count too).
  await loginGuard.clear(pool, email);
  return sessions.openSession(pool, { user, roles, meta });
}

/**
 * Refresh token rotation with reuse detection.
 * Every refresh token works ONCE. Presenting an already-rotated token means a
 * copy of it exists somewhere else (stolen or replayed), so the whole session
 * family is revoked and both holders must log in again.
 *
 * One exception, a lost response: the browser left the page (a link, F5, the
 * return from VNPay) while its refresh was running, so the API rotated the
 * token but the new cookie never arrived, and the next page load sends the
 * old one. Within REFRESH_REUSE_GRACE_SECONDS, while the successor was never
 * used, the old token is rotated once more and the lost successor revoked;
 * otherwise those page loads would log the user out.
 */
async function refresh({ refreshToken }, meta) {
  const outcome = await withTransaction(async (client) => {
    const current = await authRepository.findRefreshTokenForUpdate(client, tokens.hashRefreshToken(refreshToken), {
      graceSeconds: env.REFRESH_REUSE_GRACE_SECONDS,
    });
    if (!current) {
      return { error: 'INVALID_REFRESH_TOKEN' };
    }
    if (current.lost_rotation) {
      await authRepository.revokeRefreshToken(client, current.replaced_by_id);
    } else if (current.revoked_at) {
      if (current.replaced_by_id) {
        await authRepository.revokeRefreshTokenFamily(client, current.family_id);
        return { error: 'REFRESH_TOKEN_REUSED' };
      }
      return { error: 'INVALID_REFRESH_TOKEN' }; // logged out or revoked
    }
    if (current.expired) {
      return { error: 'INVALID_REFRESH_TOKEN' };
    }
    if (current.user_status !== USER_STATUS.ACTIVE) {
      await authRepository.revokeRefreshTokenFamily(client, current.family_id);
      return { error: 'ACCOUNT_DISABLED' };
    }
    // Roles are re-read here, so a role change takes effect at the next refresh.
    const roles = await users.findRoleCodes(client, current.user_id);
    // Phase 15: a session opened without two-factor ends for a user who needs
    // it (sessions from before, a user just made an admin, other devices of
    // someone who just turned it on).
    if (!current.mfa && (await twoFactor.needsTwoFactor(client, current.user_id, roles))) {
      await authRepository.revokeRefreshTokenFamily(client, current.family_id);
      return { error: 'MFA_REQUIRED' };
    }

    const next = await sessions.issueRefreshToken(client, {
      userId: current.user_id,
      familyId: current.family_id,
      meta,
      mfa: current.mfa,
    });
    await authRepository.markRefreshTokenRotated(client, current.id, next.id);
    return { userId: current.user_id, roles, refreshToken: next.token };
  });

  // Thrown after COMMIT so a family revocation is never rolled back.
  if (outcome.error) {
    throw new AppError(outcome.error);
  }
  return sessions.buildTokenResponse(outcome);
}

/**
 * Idempotent: an unknown or already-revoked token is not an error.
 * If the caller also sent its access token, that token stops working now
 * (denylist) instead of staying valid until it expires.
 */
async function logout({ refreshToken }, accessToken) {
  if (refreshToken) {
    await authRepository.revokeFamilyByTokenHash(pool, tokens.hashRefreshToken(refreshToken));
  }
  if (accessToken) {
    await denylist.revokeToken(accessToken);
  }
}

module.exports = { register, requestOtp, verifyOtp, login, refresh, logout, hashPassword };
