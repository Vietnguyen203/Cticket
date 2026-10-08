const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { EVENT_STATUS, SCHEDULE_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const venues = require('../venues');
const { recordAudit } = require('../audit');
const eventsRepository = require('./events.repository');
const schedulesRepository = require('./schedules.repository');
const { canView, eventNotFound, lockManageableEvent } = require('./event-access');
const { toPublicSchedule } = require('./schedules.mapper');

/** Request field → schedule row column, for merging a partial update with stored values. */
const TIME_COLUMNS = {
  startAt: 'start_at',
  endAt: 'end_at',
  salesStartAt: 'sales_start_at',
  salesEndAt: 'sales_end_at',
};

const scheduleNotFound = () => new AppError('NOT_FOUND', 'Schedule not found.');

/**
 * Time rules on the FINAL values (after a partial update is merged in).
 * end > start and the sales window are also CHECK constraints in the database;
 * checking here first gives the client field-level messages instead of a
 * generic constraint error.
 */
function assertValidTimes({ startAt, endAt, salesStartAt, salesEndAt }, now = new Date()) {
  const details = [];
  if (startAt <= now) details.push({ field: 'body.startAt', message: 'must be in the future' });
  if (endAt <= startAt) details.push({ field: 'body.endAt', message: 'must be after startAt' });
  if (salesEndAt <= salesStartAt) details.push({ field: 'body.salesEndAt', message: 'must be after salesStartAt' });
  if (salesEndAt > startAt) details.push({ field: 'body.salesEndAt', message: 'must not be after startAt' });
  if (details.length > 0) {
    throw new AppError('VALIDATION_ERROR', undefined, { details });
  }
}

async function assertActiveVenue(client, venueId) {
  if (!(await venues.findActiveVenue(client, venueId))) {
    throw new AppError('VENUE_NOT_AVAILABLE');
  }
}

async function listSchedules(actor, eventId) {
  const event = await eventsRepository.findById(pool, eventId);
  if (!event || !canView(actor, event)) {
    throw eventNotFound();
  }
  return (await schedulesRepository.listByEvent(pool, eventId)).map(toPublicSchedule);
}

/**
 * Schedules are added while the event is a DRAFT (before admin review).
 * Sales open now and close at the show start, unless given.
 * Two overlapping schedules at one venue are rejected by the database's
 * exclusion constraint → 409 SCHEDULE_CONFLICT, even if created concurrently.
 */
async function createSchedule(context, actor, eventId, body) {
  return withTransaction(async (client) => {
    const event = await lockManageableEvent(client, actor, eventId);
    if (event.status !== EVENT_STATUS.DRAFT) {
      throw new AppError('EVENT_NOT_EDITABLE', 'Schedules can only be added while the event is a DRAFT.');
    }
    const times = {
      startAt: body.startAt,
      endAt: body.endAt,
      salesStartAt: body.salesStartAt ?? new Date(),
      salesEndAt: body.salesEndAt ?? body.startAt,
    };
    assertValidTimes(times);
    await assertActiveVenue(client, body.venueId);

    const scheduleId = await schedulesRepository.insert(client, { eventId, venueId: body.venueId, ...times });
    return toPublicSchedule(await schedulesRepository.findWithVenue(client, scheduleId));
  });
}

/**
 * DRAFT event: change times/venue, or cancel.
 * PUBLISHED event: tickets may already be sold, so the only change allowed is
 * cancelling the schedule (refunds come in a later phase).
 */
async function updateSchedule(context, actor, scheduleId, body) {
  return withTransaction(async (client) => {
    const found = await schedulesRepository.findById(client, scheduleId);
    if (!found) {
      throw scheduleNotFound();
    }
    // Lock order events → event_schedules, the same everywhere in this module.
    const event = await lockManageableEvent(client, actor, found.event_id);
    const schedule = await schedulesRepository.findById(client, scheduleId, { forUpdate: true });
    if (!schedule) {
      throw scheduleNotFound();
    }

    const { status, ...changes } = body;
    const changesTime = Object.keys(changes).length > 0;
    if (event.status === EVENT_STATUS.PUBLISHED && changesTime) {
      throw new AppError('EVENT_NOT_EDITABLE', 'After publishing, a schedule can only be cancelled.');
    }
    if (![EVENT_STATUS.DRAFT, EVENT_STATUS.PUBLISHED].includes(event.status)) {
      throw new AppError('EVENT_NOT_EDITABLE');
    }
    if (schedule.status !== SCHEDULE_STATUS.SCHEDULED) {
      throw new AppError('INVALID_STATE_TRANSITION', 'This schedule is no longer active.');
    }

    if (changesTime) {
      const merged = Object.fromEntries(
        Object.entries(TIME_COLUMNS).map(([field, column]) => [field, changes[field] ?? schedule[column]]),
      );
      assertValidTimes(merged);
      if (changes.venueId) {
        await assertActiveVenue(client, changes.venueId);
      }
    }

    await schedulesRepository.update(client, scheduleId, { ...changes, status });
    if (status === SCHEDULE_STATUS.CANCELLED) {
      await recordAudit(client, {
        context,
        action: 'SCHEDULE_CANCELLED',
        entityType: 'event_schedule',
        entityId: scheduleId,
        oldValue: { status: schedule.status },
        newValue: { status },
      });
    }
    return toPublicSchedule(await schedulesRepository.findWithVenue(client, scheduleId));
  });
}

async function deleteSchedule(context, actor, scheduleId) {
  await withTransaction(async (client) => {
    const found = await schedulesRepository.findById(client, scheduleId);
    if (!found) {
      throw scheduleNotFound();
    }
    const event = await lockManageableEvent(client, actor, found.event_id);
    if (event.status !== EVENT_STATUS.DRAFT) {
      throw new AppError('EVENT_NOT_EDITABLE', 'Only schedules of a DRAFT event can be deleted. Cancel it instead.');
    }
    await schedulesRepository.remove(client, scheduleId);
  });
}

module.exports = { listSchedules, createSchedule, updateSchedule, deleteSchedule };
