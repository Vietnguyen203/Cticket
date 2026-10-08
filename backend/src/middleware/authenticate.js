const AppError = require('../utils/AppError');
const { verifyAccessToken } = require('../modules/auth');

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

/**
 * Require a valid access token: `Authorization: Bearer <jwt>`.
 * Stateless: only the signature and claims are checked, no database query.
 * On success, req.user = { id, roles }.
 */
function authenticate(req, res, next) {
  const match = BEARER_PATTERN.exec(req.get('authorization') ?? '');
  if (!match) {
    throw new AppError('UNAUTHENTICATED');
  }
  req.user = verifyAccessToken(match[1]);
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
