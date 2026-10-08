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
  return checkPermissions((granted) => requiredPermissions.every((permission) => granted.includes(permission)));
}

/**
 * Require AT LEAST ONE of the given permissions, e.g. an event can be edited
 * by its owner (event:update:own) or by an admin (event:manage:any). Which
 * events an ":own" permission covers is then checked by the service.
 */
authorize.any = function authorizeAny(...acceptedPermissions) {
  return checkPermissions((granted) => acceptedPermissions.some((permission) => granted.includes(permission)));
};

function checkPermissions(isAllowed) {
  return async (req, res, next) => {
    if (!req.user) {
      throw new AppError('UNAUTHENTICATED');
    }
    const granted = await getPermissionsForRoles(req.user.roles);
    if (!isAllowed(granted)) {
      throw new AppError('FORBIDDEN');
    }
    next();
  };
}

module.exports = authorize;
