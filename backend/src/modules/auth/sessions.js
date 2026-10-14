const { randomUUID } = require('node:crypto');
const env = require('../../config/env');
const users = require('../users');
const authRepository = require('./auth.repository');
const tokens = require('./auth.tokens');

/**
 * Issuing sessions: shared by the password login (auth.service) and the
 * two-factor steps (two-factor.service), which must not depend on each other.
 */

/** `mfa`: the session was opened with two-factor (Phase 15); rotations keep it. */
async function issueRefreshToken(db, { userId, familyId, meta, mfa = false }) {
  const { token, hash } = tokens.createRefreshToken();
  const id = await authRepository.insertRefreshToken(db, {
    userId,
    tokenHash: hash,
    familyId,
    ttlDays: env.REFRESH_TOKEN_TTL_DAYS,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
    mfa,
  });
  return { id, token };
}

function buildTokenResponse({ userId, roles, refreshToken }) {
  const { accessToken, expiresIn } = tokens.signAccessToken({ id: userId, roles });
  return { tokenType: 'Bearer', accessToken, expiresIn, refreshToken };
}

/** A new login starts a new token family (= one session on one device). */
async function openSession(db, { user, roles, meta, mfa = false }) {
  const refreshToken = await issueRefreshToken(db, { userId: user.id, familyId: randomUUID(), meta, mfa });
  return {
    ...buildTokenResponse({ userId: user.id, roles, refreshToken: refreshToken.token }),
    user: users.toPublicUser(user, roles),
  };
}

module.exports = { issueRefreshToken, buildTokenResponse, openSession };
