const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { EVENT_STATUS, SCHEDULE_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const venues = require('../venues');
const { recordAudit } = require('../audit');
const orders = require('../orders');
const payments = require('../payments');
const eventsRepository = require('./events.repository');
const schedulesRepository = require('./schedules.repository');
const ticketTypesRepository = require('./ticket-types.repository');
const { PUBLIC_STATUSES, canView, eventNotFound, lockManageableEvent } = require('./event-access');
const { toPublicSchedule } = require('./schedules.mapper');
const { remember, invalidatesAfter, NAMESPACE, TTL } = require('../../redis/cache');

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

/**
 * One event, one show: an event is one performance at one venue (its many
 * programmes and acts are in it, its guest artists are listed on the event).
 * A cancelled show does not count: the event can get a new date.
 */
async function assertNoOtherShow(client, eventId) {
  if ((await schedulesRepository.countActive(client, eventId)) > 0) {
    throw new AppError('EVENT_HAS_SCHEDULE');
  }
}

/**
 * A show's total attendance never exceeds the venue's capacity ("Sức chứa";
 * not checked when the venue has none). Returns the venue's capacity.
 */
async function assertFitsVenue(client, venueId, capacity) {
  const venue = await venues.findVenue(client, venueId);
  const venueCapacity = venue?.capacity ? Number(venue.capacity) : null;
  if (capacity && venueCapacity && capacity > venueCapacity) {
    throw new AppError('VENUE_CAPACITY_EXCEEDED', undefined, {
      details: [{ field: 'body.capacity', message: `the venue holds ${venueCapacity}`, capacity: venueCapacity, used: 0, adding: capacity }],
    });
  }
  return venueCapacity;
}

/**
 * Two shows cannot overlap at one venue. The exclusion constraint is the real
 * guard (also against two requests at the same instant); this check first
 * says WHICH show is in the way, so the organizer knows what to change.
 * Another organizer's event is not named, only its times.
 */
async function assertNoOverlap(client, { eventId, venueId, startAt, endAt, excludeScheduleId }) {
  const other = await schedulesRepository.findOverlap(client, { venueId, startAt, endAt, excludeScheduleId });
  if (other) {
    throw new AppError('SCHEDULE_CONFLICT', undefined, {
      details: [
        {
          field: 'body.startAt',
          message: 'overlaps another schedule at this venue',
          conflict: { startAt: other.start_at, endAt: other.end_at, sameEvent: other.event_id === eventId },
        },
      ],
    });
  }
}

/** ACTIVE venues, or a PENDING venue proposed by the event's own organizer (Phase 12.2). */
async function assertUsableVenue(client, venueId, event) {
  if (!(await venues.findUsableVenue(client, venueId, event.organizer_id))) {
    throw new AppError('VENUE_NOT_AVAILABLE');
  }
}

async function listSchedules(actor, eventId) {
  // Schedules of a public event come from the cache; others are read fresh.
  const cached = await remember(NAMESPACE.CATALOG, `schedules:${eventId}`, TTL.SCHEDULES, async () => {
    const publicEvent = await eventsRepository.findById(pool, eventId);
    if (!publicEvent || !PUBLIC_STATUSES.includes(publicEvent.status)) return null;
    return (await schedulesRepository.listByEvent(pool, eventId)).map(toPublicSchedule);
  });
  if (cached) return cached;

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
    await assertUsableVenue(client, body.venueId, event);
    await assertNoOtherShow(client, eventId);
    // In step with the venue: without a total given, the show is planned for the venue's capacity.
    const venueCapacity = await assertFitsVenue(client, body.venueId, body.capacity);
    await assertNoOverlap(client, { eventId, venueId: body.venueId, startAt: times.startAt, endAt: times.endAt });

    const capacity = body.capacity ?? venueCapacity;
    const scheduleId = await schedulesRepository.insert(client, { eventId, venueId: body.venueId, ...times, capacity });
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

    const { status, capacity, ...changes } = body;
    const changesTime = Object.keys(changes).length > 0;
    if (capacity !== undefined) {
      // The total attendance is planned before publishing; it cannot go below what the tiers already hold.
      if (event.status !== EVENT_STATUS.DRAFT) throw new AppError('EVENT_NOT_EDITABLE', 'The total attendance is set while the event is a DRAFT.');
      const allocated = await ticketTypesRepository.allocatedPlaces(client, scheduleId);
      if (capacity !== null) await assertFitsVenue(client, changes.venueId ?? schedule.venue_id, capacity);
      if (capacity !== null && allocated > capacity) {
        throw new AppError('CAPACITY_EXCEEDED', undefined, {
          details: [{ field: 'body.capacity', message: `the tiers already hold ${allocated}`, capacity, allocated }],
        });
      }
    }
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
      if (changes.venueId && changes.venueId !== schedule.venue_id) {
        // Ticket types and the seat plan point at zones/seats of the CURRENT venue.
        if ((await ticketTypesRepository.countBySchedule(client, scheduleId)) > 0) {
          throw new AppError('VENUE_CHANGE_BLOCKED');
        }
        await assertUsableVenue(client, changes.venueId, event);
        // The show's total stays within the capacity of its new venue.
        if (capacity === undefined) await assertFitsVenue(client, changes.venueId, schedule.capacity);
      }
      await assertNoOverlap(client, {
        eventId: event.id,
        venueId: changes.venueId ?? schedule.venue_id,
        startAt: merged.startAt,
        endAt: merged.endAt,
        excludeScheduleId: scheduleId,
      });
    }

    await schedulesRepository.update(client, scheduleId, { ...changes, ...(capacity !== undefined ? { capacity } : {}), status });
    if (status === SCHEDULE_STATUS.CANCELLED) {
      const heldOrdersCancelled = await orders.cancelHeldOrdersOfSchedule(client, scheduleId);
      const paidOrdersRefunded = await payments.refundPaidOrdersOfSchedule(client, scheduleId, {
        reason: 'Schedule cancelled',
        context,
      });
      await recordAudit(client, {
        context,
        action: 'SCHEDULE_CANCELLED',
        entityType: 'event_schedule',
        entityId: scheduleId,
        oldValue: { status: schedule.status },
        newValue: { status, heldOrdersCancelled, paidOrdersRefunded },
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

module.exports = {
  listSchedules,
  createSchedule: invalidatesAfter([NAMESPACE.CATALOG], createSchedule),
  updateSchedule: invalidatesAfter([NAMESPACE.CATALOG], updateSchedule),
  deleteSchedule: invalidatesAfter([NAMESPACE.CATALOG], deleteSchedule),
};
