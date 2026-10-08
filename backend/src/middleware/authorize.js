const AppError = require('../utils/AppError');
const { getPermissionsForRoles } = require('../modules/users');

/**
 * Require ALL of the given permissions. Use after `authenticate`.
 *
 *   router.post('/events', authenticate, authorize('event:create'), controller.create)
 *
 * Routes check permissions, never role names, so a role can gain or lose an
 * ability by editing role_permissions — without touching code.
 *
 * @param {...string} requiredPermissions
 */
function authorize(...requiredPermissions) {
  return async (req, res, next) => {
    if (!req.user) {
      throw new AppError('UNAUTHENTICATED');
    }
    const granted = await getPermissionsForRoles(req.user.roles);
    if (!requiredPermissions.every((permission) => granted.includes(permission))) {
      throw new AppError('FORBIDDEN');
    }
    next();
  };
}

module.exports = authorize;
