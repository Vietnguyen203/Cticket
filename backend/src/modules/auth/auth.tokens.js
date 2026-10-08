const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
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

/** @returns {{ id: string, roles: string[] }} */
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
  return { id: claims.sub, roles: claims.roles };
}

/** Opaque refresh token: the client keeps `token`, the database keeps only `hash`. */
function createRefreshToken() {
  const token = randomToken();
  return { token, hash: sha256(token) };
}

function hashRefreshToken(token) {
  return sha256(token);
}

module.exports = { signAccessToken, verifyAccessToken, createRefreshToken, hashRefreshToken };
