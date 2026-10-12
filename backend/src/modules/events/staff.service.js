const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { ROLES, USER_STATUS, EVENT_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const users = require('../users');
const { recordAudit } = require('../audit');
const eventsRepository = require('./events.repository');
const staffRepository = require('./staff.repository');
const { canManage, eventNotFound, lockManageableEvent } = require('./event-access');

const CLOSED_STATUSES = [EVENT_STATUS.CANCELLED, EVENT_STATUS.FINISHED];

function toStaff(row) {
  return {
    userId: row.user_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    assignedAt: row.assigned_at,
  };
}

/**
 * The owning organizer (or an admin) puts someone on the gate team of an
 * event, by email. That person gets the STAFF role if they do not have it
 * (effective at their next token refresh), but may only scan tickets of
 * events they are assigned to.
 */
async function assignStaff(context, actor, eventId, { email }) {
  return withTransaction(async (client) => {
    const event = await lockManageableEvent(client, actor, eventId);
    if (CLOSED_STATUSES.includes(event.status)) {
      throw new AppError('EVENT_NOT_EDITABLE', 'Staff cannot be assigned to a cancelled or finished event.');
    }
    const user = await users.findByEmail(client, email);
    if (!user || user.status !== USER_STATUS.ACTIVE) throw new AppError('STAFF_USER_NOT_FOUND');

    await users.addRole(client, user.id, ROLES.STAFF);
    if (await staffRepository.assign(client, { eventId, userId: user.id, assignedBy: actor.userId })) {
      await recordAudit(client, {
        context,
        action: 'STAFF_ASSIGNED',
        entityType: 'event',
        entityId: eventId,
        newValue: { userId: user.id },
      });
    }
    return (await staffRepository.listByEvent(client, eventId)).map(toStaff).find((s) => s.userId === user.id);
  });
}

async function listStaff(actor, eventId) {
  const event = await eventsRepository.findById(pool, eventId);
  if (!event || !canManage(actor, event)) throw eventNotFound();
  return (await staffRepository.listByEvent(pool, eventId)).map(toStaff);
}

/** Removes the person from this event only: they may work at other events, so the STAFF role stays. */
async function removeStaff(context, actor, eventId, userId) {
  await withTransaction(async (client) => {
    await lockManageableEvent(client, actor, eventId);
    if (!(await staffRepository.remove(client, { eventId, userId }))) {
      throw new AppError('NOT_FOUND', 'This person is not on the staff of the event.');
    }
    await recordAudit(client, {
      context,
      action: 'STAFF_REMOVED',
      entityType: 'event',
      entityId: eventId,
      oldValue: { userId },
    });
  });
}

/** APP-S01: the events I work at, with their upcoming / running schedules. */
async function listMyEvents(userId) {
  return staffRepository.eventsOfStaff(pool, userId);
}

module.exports = { assignStaff, listStaff, removeStaff, listMyEvents };
