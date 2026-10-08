const { pool } = require('../../database/pool');
const usersRepository = require('./users.repository');

/**
 * role → permissions map, cached in memory.
 * role_permissions changes very rarely, while authorize() runs on almost every
 * request, so querying it each time would be wasted work. A change made in the
 * database is picked up within CACHE_TTL_MS.
 */
const CACHE_TTL_MS = 60_000;

let permissionsByRole = null; // Map<roleCode, string[]>
let loadedAt = 0;
let pendingLoad = null;

async function loadRolePermissions() {
  const rows = await usersRepository.findAllRolePermissions(pool);
  const map = new Map();
  for (const { role, permission } of rows) {
    if (!map.has(role)) map.set(role, []);
    map.get(role).push(permission);
  }
  permissionsByRole = map;
  loadedAt = Date.now();
}

/** Union of the permissions of all given roles, sorted. */
async function getPermissionsForRoles(roles) {
  if (!permissionsByRole || Date.now() - loadedAt > CACHE_TTL_MS) {
    // Requests arriving while the cache reloads share ONE database query.
    pendingLoad ??= loadRolePermissions().finally(() => {
      pendingLoad = null;
    });
    await pendingLoad;
  }

  const permissions = new Set();
  for (const role of roles) {
    for (const permission of permissionsByRole.get(role) ?? []) {
      permissions.add(permission);
    }
  }
  return [...permissions].sort();
}

function clearRbacCache() {
  permissionsByRole = null;
}

module.exports = { getPermissionsForRoles, clearRbacCache };
