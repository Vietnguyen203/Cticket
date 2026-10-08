const { EVENT_STATUS, ORGANIZER_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const users = require('../users');
const organizers = require('../organizers');
const eventsRepository = require('./events.repository');

/** Statuses anyone may see. Others are visible only to the owner and admins. */
const PUBLIC_STATUSES = [EVENT_STATUS.PUBLISHED, EVENT_STATUS.FINISHED];

/**
 * Everything the events module needs to know about the caller, resolved once
 * per request. Anonymous callers get an actor with no rights.
 *
 * - organizerId: set only for an ACTIVE organizer (a suspended organizer
 *   loses access to their events until reactivated)
 * - canManageAny: admin moderation (event:manage:any)
 * - canApprove: can approve/reject submitted events (event:approve)
 */
async function resolveActor(user) {
  if (!user) {
    return { userId: null, organizerId: null, canManageAny: false, canApprove: false };
  }
  const permissions = await users.getPermissionsForRoles(user.roles);
  const organizer = await organizers.findOrganizerByUserId(user.id);
  return {
    userId: user.id,
    organizerId: organizer?.status === ORGANIZER_STATUS.ACTIVE ? organizer.id : null,
    canManageAny: permissions.includes('event:manage:any'),
    canApprove: permissions.includes('event:approve'),
  };
}

function isOwner(actor, event) {
  return actor.organizerId !== null && event.organizer_id === actor.organizerId;
}

function canManage(actor, event) {
  return actor.canManageAny || isOwner(actor, event);
}

function canView(actor, event) {
  return PUBLIC_STATUSES.includes(event.status) || canManage(actor, event) || actor.canApprove;
}

const eventNotFound = () => new AppError('NOT_FOUND', 'Event not found.');

/**
 * Lock the event row and check the caller may manage it. Locking first means
 * concurrent edits / status changes of the same event run one after another.
 * Lock order in the events module is always: events → event_schedules.
 * Someone else's event is reported as 404, not 403: we do not even confirm
 * that it exists.
 */
async function lockManageableEvent(client, actor, eventId) {
  const event = await eventsRepository.findById(client, eventId, { forUpdate: true });
  if (!event || !canManage(actor, event)) {
    throw eventNotFound();
  }
  return event;
}

module.exports = {
  PUBLIC_STATUSES,
  resolveActor,
  isOwner,
  canManage,
  canView,
  eventNotFound,
  lockManageableEvent,
};
