const { ORGANIZER_STATUS } = require('../../config/constants');
const { getPermissionsForRoles } = require('../users');
const organizers = require('../organizers');

const MANAGE_PERMISSION = 'venue:manage';
const PROPOSE_PERMISSION = 'venue:propose';

/**
 * What the caller may do with venues: manage all of them (admin), and/or
 * see / build the PENDING venues they proposed as an ACTIVE organizer.
 * @returns {Promise<{ canManage: boolean, organizerId: string|null }>}
 */
async function viewerOf(req) {
  if (!req.user) return { canManage: false, organizerId: null };
  const permissions = await getPermissionsForRoles(req.user.roles);
  let organizerId = null;
  if (permissions.includes(PROPOSE_PERMISSION)) {
    const organizer = await organizers.findOrganizerByUserId(req.user.id);
    organizerId = organizer?.status === ORGANIZER_STATUS.ACTIVE ? organizer.id : null;
  }
  return { canManage: permissions.includes(MANAGE_PERMISSION), organizerId };
}

module.exports = { viewerOf };
