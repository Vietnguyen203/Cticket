const { pool } = require('../../database/pool');
const AppError = require('../../utils/AppError');
const usersRepository = require('./users.repository');
const { getPermissionsForRoles } = require('./rbac');

/**
 * The only shape in which a user leaves the API. Explicit field list, so a
 * new column (or password_hash) can never leak by accident.
 */
function toPublicUser(row, roles) {
  const user = {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    createdAt: row.created_at,
  };
  if (roles) {
    user.roles = roles;
  }
  return user;
}

/** Current user's profile with roles and effective permissions. */
async function getProfile(userId) {
  const user = await usersRepository.findById(pool, userId);
  if (!user) {
    // The token is valid but the account no longer exists.
    throw new AppError('UNAUTHENTICATED');
  }
  const roles = await usersRepository.findRoleCodes(pool, userId);
  const permissions = await getPermissionsForRoles(roles);
  return { ...toPublicUser(user, roles), permissions };
}

module.exports = { toPublicUser, getProfile };
