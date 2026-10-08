/**
 * Public API of the users module. Other modules import from here, never from
 * the users repository directly.
 */
const usersRepository = require('./users.repository');
const usersService = require('./users.service');
const rbac = require('./rbac');

module.exports = {
  insertUser: usersRepository.insertUser,
  findByEmail: usersRepository.findByEmail,
  addRole: usersRepository.addRole,
  findRoleCodes: usersRepository.findRoleCodes,
  markEmailVerified: usersRepository.markEmailVerified,
  updatePasswordHash: usersRepository.updatePasswordHash,
  toPublicUser: usersService.toPublicUser,
  getProfile: usersService.getProfile,
  getPermissionsForRoles: rbac.getPermissionsForRoles,
  clearRbacCache: rbac.clearRbacCache,
};
