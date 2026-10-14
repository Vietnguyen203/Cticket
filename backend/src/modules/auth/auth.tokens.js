const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const { TWO_FACTOR } = require('../../config/constants');
const { randomToken, sha256 } = require('../../utils/crypto');

// Pinning the algorithm on BOTH sign and verify blocks the classic JWT attacks
// where a forged token declares `alg: none` or switches to another algorithm.
const ALGORITHM = 'HS256';
const ACCESS_TOKEN_TYPE = 'access';

/**
 * Short-lived, stateless access token. Claims: sub = user id, roles, typ.
 * @param {{ id: string, roles: string[] }} user
 */
function signAccessToken({ id, roles }) {
  const accessToken = jwt.sign({ typ: ACCESS_TOKEN_TYPE, roles }, env.JWT_ACCESS_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    subject: id,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    jwtid: randomUUID(),
  });
  return { accessToken, expiresIn: env.JWT_ACCESS_TTL_SECONDS };
}

/** @returns {{ id: string, roles: string[], jti: string, issuedAt: number, expiresAt: number }} */
function verifyAccessToken(token) {
  let claims;
  try {
    claims = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: [ALGORITHM],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
  } catch (err) {
    // A distinct code tells the app to call /auth/refresh instead of logging out.
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError('TOKEN_EXPIRED', undefined, { cause: err });
    }
    throw new AppError('UNAUTHENTICATED', undefined, { cause: err });
  }

  if (claims.typ !== ACCESS_TOKEN_TYPE || typeof claims.sub !== 'string' || !Array.isArray(claims.roles)) {
    throw new AppError('UNAUTHENTICATED');
  }
  return { id: claims.sub, roles: claims.roles, jti: claims.jti, issuedAt: claims.iat, expiresAt: claims.exp };
}

/**
 * Phase 15: between a correct password and the two-factor code. A JWT of
 * its own type ("mfa"), so it can never be used as an access token, and
 * with a purpose: "verify" (enter a code) or "setup" (an admin who must set
 * two-factor up first). `remember` carries the login's "remember me".
 */
const MFA_TOKEN_TYPE = 'mfa';

function signMfaToken({ userId, purpose, remember }) {
  return jwt.sign({ typ: MFA_TOKEN_TYPE, purpose, remember: Boolean(remember) }, env.JWT_ACCESS_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: TWO_FACTOR.MFA_TOKEN_TTL_SECONDS,
    subject: userId,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    jwtid: randomUUID(),
  });
}

/** @returns {{ userId: string, jti: string, remember: boolean, expiresAt: number }} */
function verifyMfaToken(token, purpose) {
  let claims;
  try {
    claims = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [ALGORITHM], issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE });
  } catch (err) {
    throw new AppError('MFA_TOKEN_INVALID', undefined, { cause: err });
  }
  if (claims.typ !== MFA_TOKEN_TYPE || claims.purpose !== purpose || typeof claims.sub !== 'string') {
    throw new AppError('MFA_TOKEN_INVALID');
  }
  return { userId: claims.sub, jti: claims.jti, remember: claims.remember === true, expiresAt: claims.exp };
}

/** Opaque refresh token: the client keeps `token`, the database keeps only `hash`. */
function createRefreshToken() {
  const token = randomToken();
  return { token, hash: sha256(token) };
}

function hashRefreshToken(token) {
  return sha256(token);
}

module.exports = { signAccessToken, verifyAccessToken, signMfaToken, verifyMfaToken, createRefreshToken, hashRefreshToken };
