const AppError = require('../utils/AppError');
const { verifyAccessToken, isRevoked } = require('../modules/auth');

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

/**
 * Require a valid access token: `Authorization: Bearer <jwt>`.
 * The signature and claims are checked locally; then one Redis lookup tells
 * whether the token was logged out or revoked (skipped if Redis is down).
 * On success, req.user = { id, roles, jti, issuedAt, expiresAt }.
 */
async function authenticate(req, res, next) {
  const match = BEARER_PATTERN.exec(req.get('authorization') ?? '');
  if (!match) {
    throw new AppError('UNAUTHENTICATED');
  }
  const user = verifyAccessToken(match[1]);
  if (await isRevoked(user)) {
    throw new AppError('TOKEN_REVOKED');
  }
  req.user = user;
  next();
}

/**
 * For public routes that show more to logged-in users (e.g. an organizer can
 * see their own DRAFT event). No header → anonymous. A header that is present
 * but invalid is still rejected: silently ignoring it would hide client bugs.
 */
authenticate.optional = function optionalAuthenticate(req, res, next) {
  if (!req.get('authorization')) {
    return next();
  }
  return authenticate(req, res, next);
};

module.exports = authenticate;
