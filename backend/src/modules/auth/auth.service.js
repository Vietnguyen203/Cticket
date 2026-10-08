const { randomUUID } = require('node:crypto');
const bcrypt = require('bcrypt');
const env = require('../../config/env');
const { ROLES, USER_STATUS, OTP_PURPOSE } = require('../../config/constants');
const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const AppError = require('../../utils/AppError');
const users = require('../users');
const authRepository = require('./auth.repository');
const tokens = require('./auth.tokens');
const otpService = require('./otp.service');

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

async function issueRefreshToken(db, { userId, familyId, meta }) {
  const { token, hash } = tokens.createRefreshToken();
  const id = await authRepository.insertRefreshToken(db, {
    userId,
    tokenHash: hash,
    familyId,
    ttlDays: env.REFRESH_TOKEN_TTL_DAYS,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });
  return { id, token };
}

function buildTokenResponse({ userId, roles, refreshToken }) {
  const { accessToken, expiresIn } = tokens.signAccessToken({ id: userId, roles });
  return { tokenType: 'Bearer', accessToken, expiresIn, refreshToken };
}

// ---------------------------------------------------------------------------
// Registration and OTP
// ---------------------------------------------------------------------------

async function register({ email, password, firstName, lastName, phone }) {
  // bcrypt is deliberately slow (~250 ms). Hash BEFORE opening the transaction
  // so we never hold a database connection while hashing.
  const passwordHash = await hashPassword(password);

  // User, role and verification code are created together or not at all:
  // there is never an account without a role or without a way to verify it.
  // A duplicate email is rejected by the UNIQUE index (→ 409 EMAIL_TAKEN),
  // which stays correct even when two registrations race each other.
  const { user, code } = await withTransaction(async (client) => {
    const created = await users.insertUser(client, {
      email,
      passwordHash,
      firstName,
      lastName,
      phone,
      status: USER_STATUS.PENDING_VERIFICATION,
    });
    await users.addRole(client, created.id, ROLES.CUSTOMER);
    const otp = await otpService.issueOtp(client, created.id, OTP_PURPOSE.EMAIL_VERIFICATION);
    return { user: created, code: otp };
  });

  await otpService.sendOtpEmail(user, OTP_PURPOSE.EMAIL_VERIFICATION, code);
  return users.toPublicUser(user, [ROLES.CUSTOMER]);
}

/**
 * Send (or re-send) a code. Never reveals whether the email exists, whether
 * the account is eligible, or whether a limit was hit: the caller always
 * gets the same 202 response.
 */
async function requestOtp({ email, purpose }) {
  const issued = await withTransaction(async (client) => {
    // Locking the user row serializes concurrent requests for the same user,
    // so the cooldown / hourly limit cannot be bypassed by parallel calls.
    const user = await users.findByEmail(client, email, { forUpdate: true });
    if (!user || user.status !== REQUIRED_STATUS[purpose]) {
      return null;
    }
    const code = await otpService.issueOtp(client, user.id, purpose);
    return code ? { user, code } : null;
  });

  if (issued) {
    await otpService.sendOtpEmail(issued.user, purpose, issued.code);
  }
}

/**
 * EMAIL_VERIFICATION: activates the account.
 * PASSWORD_RESET: sets the new password and logs the user out everywhere.
 */
async function verifyOtp({ email, purpose, otp, newPassword }) {
  const newPasswordHash = purpose === OTP_PURPOSE.PASSWORD_RESET ? await hashPassword(newPassword) : null;

  const verified = await withTransaction(async (client) => {
    // Lock order users → user_tokens, the same as requestOtp, so the two
    // can never deadlock each other.
    const user = await users.findByEmail(client, email, { forUpdate: true });
    if (!user || user.status !== REQUIRED_STATUS[purpose]) {
      return false;
    }
    if (!(await otpService.consumeOtp(client, user.id, purpose, otp))) {
      return false; // COMMIT anyway: the failed attempt must be counted
    }

    if (purpose === OTP_PURPOSE.EMAIL_VERIFICATION) {
      await users.markEmailVerified(client, user.id);
    } else {
      await users.updatePasswordHash(client, user.id, newPasswordHash);
      await authRepository.revokeAllRefreshTokensOfUser(client, user.id);
    }
    return true;
  });

  // Thrown only after COMMIT, so the attempt counter is persisted.
  if (!verified) {
    throw new AppError('INVALID_OTP');
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

async function login({ email, password }, meta) {
  const user = await users.findByEmail(pool, email);
  const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? (await getDummyHash()));

  // Same error for "no such email" and "wrong password".
  if (!user || !passwordMatches) {
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
  // A new login starts a new token family (= one session on one device).
  const refreshToken = await issueRefreshToken(pool, { userId: user.id, familyId: randomUUID(), meta });

  return {
    ...buildTokenResponse({ userId: user.id, roles, refreshToken: refreshToken.token }),
    user: users.toPublicUser(user, roles),
  };
}

/**
 * Refresh token rotation with reuse detection.
 * Every refresh token works ONCE. Presenting an already-rotated token means a
 * copy of it exists somewhere else (stolen or replayed), so the whole session
 * family is revoked and both holders must log in again.
 */
async function refresh({ refreshToken }, meta) {
  const outcome = await withTransaction(async (client) => {
    const current = await authRepository.findRefreshTokenForUpdate(client, tokens.hashRefreshToken(refreshToken));
    if (!current) {
      return { error: 'INVALID_REFRESH_TOKEN' };
    }
    if (current.revoked_at) {
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

    const next = await issueRefreshToken(client, { userId: current.user_id, familyId: current.family_id, meta });
    await authRepository.markRefreshTokenRotated(client, current.id, next.id);
    // Roles are re-read here, so a role change takes effect at the next refresh.
    const roles = await users.findRoleCodes(client, current.user_id);
    return { userId: current.user_id, roles, refreshToken: next.token };
  });

  // Thrown after COMMIT so a family revocation is never rolled back.
  if (outcome.error) {
    throw new AppError(outcome.error);
  }
  return buildTokenResponse(outcome);
}

/** Idempotent: an unknown or already-revoked token is not an error. */
async function logout({ refreshToken }) {
  await authRepository.revokeFamilyByTokenHash(pool, tokens.hashRefreshToken(refreshToken));
}

module.exports = { register, requestOtp, verifyOtp, login, refresh, logout, hashPassword };
