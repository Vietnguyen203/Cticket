const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { CHECKIN, SCHEDULE_STATUS, TICKET_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { safeEqualHex } = require('../../utils/crypto');
const { toLimitOffset, toPageMeta } = require('../../utils/pagination');
const { publish } = require('../../realtime/publisher');
const { MESSAGE, userRoom } = require('../../realtime/messages');
const events = require('../events');
const tickets = require('../tickets');
const checkinsRepository = require('./checkins.repository');

const MINUTE_MS = 60_000;

const fullName = (first, last) => [first, last].filter(Boolean).join(' ');

/** How a ticket got in: when, at which gate, by whom (no customer data). */
function toEntry(row) {
  return {
    checkedInAt: row.checked_in_at,
    deviceId: row.device_id,
    staffName: fullName(row.staff_first_name, row.staff_last_name),
  };
}

function toStats(scheduleId, rows) {
  const byTicketType = rows.map((row) => ({
    ticketTypeId: row.ticket_type_id,
    ticketTypeName: row.ticket_type_name,
    total: row.total,
    checkedIn: row.checked_in,
  }));
  return {
    scheduleId,
    total: byTicketType.reduce((sum, type) => sum + type.total, 0),
    checkedIn: byTicketType.reduce((sum, type) => sum + type.checkedIn, 0),
    byTicketType,
  };
}

/** Gates open 3 hours before the show and close when it ends. */
function assertCheckInOpen(ticket, now = new Date()) {
  const opensAt = new Date(ticket.start_at.getTime() - CHECKIN.OPENS_MINUTES_BEFORE_START * MINUTE_MS);
  if (now < opensAt) throw new AppError('CHECKIN_NOT_OPEN', undefined, { details: { opensAt } });
  if (now > ticket.end_at) throw new AppError('CHECKIN_CLOSED', undefined, { details: { closedAt: ticket.end_at } });
}

/**
 * CHK-01: scan a ticket at the gate of `scheduleId`. One transaction around
 * the ticket row lock, so two gates scanning the same ticket at the same
 * moment end with exactly one entry: the second waits for the lock, then
 * sees USED. Every rejection rolls back: nothing is written.
 */
async function checkIn(staff, { qrToken, scheduleId, deviceId }) {
  const parsed = tickets.parseQrToken(qrToken);
  if (!parsed) throw new AppError('QR_INVALID');
  const actor = await events.resolveActor(staff);

  const result = await withTransaction(async (client) => {
    const ticket = await tickets.lockTicketForCheckIn(client, parsed.ticketId);
    // Only the CURRENT version of the QR opens the gate: a re-issued QR (TKT-03) retires the old one.
    if (!ticket || !safeEqualHex(tickets.qrTokenHash(qrToken.trim()), ticket.qr_token_hash)) {
      throw new AppError('QR_INVALID');
    }
    if (!actor.canManageAny && !(await events.isEventStaff(client, ticket.event_id, staff.id))) {
      throw new AppError('FORBIDDEN', 'You are not on the staff of this event.');
    }
    if (ticket.schedule_id !== scheduleId) {
      throw new AppError('WRONG_SCHEDULE', undefined, {
        details: { schedule: { id: ticket.schedule_id, startAt: ticket.start_at, venueName: ticket.venue_name } },
      });
    }
    assertCheckInOpen(ticket);

    if (ticket.status === TICKET_STATUS.USED) {
      const entry = await checkinsRepository.findByTicket(client, ticket.id);
      throw new AppError('TICKET_ALREADY_USED', undefined, { details: entry ? toEntry(entry) : undefined });
    }
    if (ticket.status !== TICKET_STATUS.VALID || ticket.schedule_status === SCHEDULE_STATUS.CANCELLED) {
      throw new AppError('TICKET_NOT_VALID', undefined, { details: { status: ticket.status } });
    }

    const entry = await checkinsRepository.insert(client, {
      ticketId: ticket.id,
      eventId: ticket.event_id,
      scheduleId: ticket.schedule_id,
      staffUserId: staff.id,
      deviceId,
    });
    await tickets.markTicketUsed(client, ticket.id); // VALID under our lock: always succeeds

    // What the gate needs to match the person to the ticket. Never the buyer's name, email or phone.
    return {
      checkIn: { id: entry.id, checkedInAt: entry.checked_in_at, deviceId: entry.device_id },
      ticket: {
        id: ticket.id,
        code: ticket.ticket_code,
        ticketTypeName: ticket.ticket_type_name,
        seatLabel: ticket.seat_label,
        admissionNo: ticket.admission_no,
        status: TICKET_STATUS.USED,
      },
      event: { id: ticket.event_id, title: ticket.event_title },
      schedule: { id: ticket.schedule_id, startAt: ticket.start_at },
    };
  });

  // Counted AFTER commit, so scans committed meanwhile at other gates are included.
  // The entry is saved whatever happens here: a failure only costs the live numbers.
  try {
    result.stats = await announceCheckIn(result);
  } catch (err) {
    logger.warn({ err, scheduleId }, 'Check-in saved but the live stats update failed');
    result.stats = null;
  }
  return result;
}

/** CHK-03: new totals to the event's staff and its organizer (personal rooms: these numbers are internal). */
async function announceCheckIn({ event, schedule, ticket, checkIn: entry }) {
  const stats = toStats(schedule.id, await checkinsRepository.statsBySchedule(pool, schedule.id));
  const message = {
    type: MESSAGE.CHECK_IN_SUCCESS,
    eventId: event.id,
    scheduleId: schedule.id,
    checkedIn: stats.checkedIn,
    total: stats.total,
    ticketTypeName: ticket.ticketTypeName,
    checkedInAt: entry.checkedInAt,
  };
  for (const userId of await events.eventAudience(pool, event.id)) {
    await publish(userRoom(userId), message);
  }
  return stats;
}

/**
 * Who may follow a schedule's gates: its assigned staff, the organizer who
 * owns the event, an admin. Anyone else gets 404.
 */
async function loadFollowedSchedule(user, scheduleId) {
  const notFound = () => new AppError('NOT_FOUND', 'Schedule not found.');
  const schedule = await events.findScheduleById(pool, scheduleId);
  if (!schedule) throw notFound();
  const event = await events.findEventById(pool, schedule.event_id);
  if (events.canManage(await events.resolveActor(user), event)) return schedule;
  if (await events.isEventStaff(pool, event.id, user.id)) return schedule;
  throw notFound();
}

/** CHK-02 */
async function listCheckIns(user, scheduleId, { page, pageSize }) {
  await loadFollowedSchedule(user, scheduleId);
  const { rows, total } = await checkinsRepository.listBySchedule(pool, {
    scheduleId,
    ...toLimitOffset({ page, pageSize }),
  });
  return {
    checkIns: rows.map((row) => ({
      id: row.id,
      ...toEntry(row),
      staffUserId: row.staff_user_id,
      ticket: {
        id: row.ticket_id,
        code: row.ticket_code,
        ticketTypeName: row.ticket_type_name,
        seatLabel: row.seat_label,
        admissionNo: row.admission_no,
      },
    })),
    meta: toPageMeta({ page, pageSize }, total),
  };
}

/** CHK-03 */
async function getStats(user, scheduleId) {
  await loadFollowedSchedule(user, scheduleId);
  return toStats(scheduleId, await checkinsRepository.statsBySchedule(pool, scheduleId));
}

module.exports = { checkIn, listCheckIns, getStats };
