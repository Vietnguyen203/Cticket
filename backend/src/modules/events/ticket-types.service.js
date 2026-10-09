const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { EVENT_STATUS, INVENTORY_MODE, ZONE_KIND, INVENTORY_LIMITS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const venues = require('../venues');
const ticketTypesRepository = require('./ticket-types.repository');
const inventoryRepository = require('./inventory.repository');
const schedulesRepository = require('./schedules.repository');
const eventsRepository = require('./events.repository');
const { canView, canManage, eventNotFound, scheduleNotFound, lockScheduleOfManageableEvent } = require('./event-access');

/** After publishing, inventory exists: only pausing/resuming sales is allowed. */
const EDITABLE_WHEN_PUBLISHED = ['status'];

const ticketTypeNotFound = () => new AppError('NOT_FOUND', 'Ticket type not found.');
const invalid = (field, message) =>
  new AppError('TICKET_TYPE_INVALID', undefined, { details: [{ field: `body.${field}`, message }] });

function toPublicTicketType(row) {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    code: row.code,
    name: row.name,
    description: row.description,
    price: row.price,
    currency: row.currency,
    inventoryMode: row.inventory_mode,
    capacity: row.capacity,
    venueZoneId: row.venue_zone_id,
    maxPerOrder: row.max_per_order,
    sortOrder: row.sort_order,
    status: row.status,
  };
}

function assertDraft(event) {
  if (event.status !== EVENT_STATUS.DRAFT) {
    throw new AppError('EVENT_NOT_EDITABLE', 'Ticket types and the seat plan can only change while the event is a DRAFT.');
  }
}

/**
 * A GA ticket type may be shown on a STANDING zone of the schedule's venue.
 * All GA ticket types sold through that zone together must fit its capacity.
 */
async function assertValidGaZone(client, schedule, { zoneId, capacity, excludeTicketTypeId }) {
  const zone = await venues.findZone(client, zoneId);
  if (!zone || zone.venue_id !== schedule.venue_id) {
    throw invalid('venueZoneId', 'must be a zone of the schedule venue');
  }
  if (zone.kind !== ZONE_KIND.STANDING) {
    throw invalid('venueZoneId', 'general admission tickets need a STANDING zone (or no zone)');
  }
  const alreadyAllocated = await ticketTypesRepository.sumGaCapacityForZone(client, {
    scheduleId: schedule.id,
    zoneId,
    excludeTicketTypeId,
  });
  if (alreadyAllocated + capacity > zone.capacity) {
    throw invalid('capacity', `the zone holds ${zone.capacity}; ${alreadyAllocated} are already allocated`);
  }
}

async function listTicketTypes(actor, scheduleId) {
  const schedule = await schedulesRepository.findById(pool, scheduleId);
  if (!schedule) throw scheduleNotFound();
  const event = await eventsRepository.findById(pool, schedule.event_id);
  if (!canView(actor, event)) throw eventNotFound();
  return (await ticketTypesRepository.listBySchedule(pool, scheduleId)).map(toPublicTicketType);
}

async function createTicketType(context, actor, scheduleId, body) {
  return withTransaction(async (client) => {
    const { event, schedule } = await lockScheduleOfManageableEvent(client, actor, scheduleId);
    assertDraft(event);
    if (body.inventoryMode === INVENTORY_MODE.GENERAL_ADMISSION && body.venueZoneId) {
      await assertValidGaZone(client, schedule, { zoneId: body.venueZoneId, capacity: body.capacity });
    }
    // A duplicate code in the schedule fails UNIQUE(schedule_id, code) → 409.
    const row = await ticketTypesRepository.insert(client, {
      ...body,
      scheduleId,
      maxPerOrder: body.maxPerOrder ?? INVENTORY_LIMITS.DEFAULT_MAX_PER_ORDER,
    });
    return toPublicTicketType(row);
  });
}

async function lockTicketType(client, actor, ticketTypeId) {
  const ticketType = await ticketTypesRepository.findById(client, ticketTypeId);
  if (!ticketType) throw ticketTypeNotFound();
  const { event, schedule } = await lockScheduleOfManageableEvent(client, actor, ticketType.schedule_id);
  return { event, schedule, ticketType };
}

async function updateTicketType(context, actor, ticketTypeId, changes) {
  return withTransaction(async (client) => {
    const { event, schedule, ticketType } = await lockTicketType(client, actor, ticketTypeId);

    if (event.status === EVENT_STATUS.PUBLISHED) {
      const locked = Object.keys(changes).filter((key) => !EDITABLE_WHEN_PUBLISHED.includes(key));
      if (locked.length > 0) {
        throw new AppError('EVENT_NOT_EDITABLE', 'After publishing, a ticket type can only be paused or resumed.', {
          details: locked.map((field) => ({ field: `body.${field}`, message: 'cannot change after publishing' })),
        });
      }
    } else {
      assertDraft(event);
    }

    const isGa = ticketType.inventory_mode === INVENTORY_MODE.GENERAL_ADMISSION;
    if (!isGa && (changes.capacity !== undefined || changes.venueZoneId)) {
      throw invalid('capacity', 'reserved ticket types get their size from the seat plan');
    }
    if (isGa && changes.capacity === null) {
      throw invalid('capacity', 'general admission needs a capacity');
    }
    const zoneId = changes.venueZoneId !== undefined ? changes.venueZoneId : ticketType.venue_zone_id;
    if (isGa && zoneId && (changes.venueZoneId !== undefined || changes.capacity !== undefined)) {
      await assertValidGaZone(client, schedule, {
        zoneId,
        capacity: changes.capacity ?? ticketType.capacity,
        excludeTicketTypeId: ticketTypeId,
      });
    }

    return toPublicTicketType(await ticketTypesRepository.update(client, ticketTypeId, changes));
  });
}

async function deleteTicketType(context, actor, ticketTypeId) {
  await withTransaction(async (client) => {
    const { event } = await lockTicketType(client, actor, ticketTypeId);
    assertDraft(event);
    await ticketTypesRepository.remove(client, ticketTypeId);
  });
}

// ---------------------------------------------------------------------------
// Seat plan
// ---------------------------------------------------------------------------

async function getSeatPlan(actor, scheduleId) {
  const schedule = await schedulesRepository.findById(pool, scheduleId);
  if (!schedule) throw scheduleNotFound();
  const event = await eventsRepository.findById(pool, schedule.event_id);
  if (!canManage(actor, event)) throw eventNotFound();

  const [ticketTypes, plan] = await Promise.all([
    ticketTypesRepository.listBySchedule(pool, scheduleId),
    inventoryRepository.listPlan(pool, scheduleId),
  ]);
  const seatsPerType = Object.fromEntries(ticketTypes.map((tt) => [tt.id, 0]));
  for (const row of plan) seatsPerType[row.ticket_type_id] += 1;

  return {
    scheduleId,
    totalAssignedSeats: plan.length,
    ticketTypes: ticketTypes
      .filter((tt) => tt.inventory_mode === INVENTORY_MODE.RESERVED)
      .map((tt) => ({ ticketTypeId: tt.id, code: tt.code, name: tt.name, seats: seatsPerType[tt.id] })),
    assignments: plan.map((row) => ({ seatId: row.seat_id, ticketTypeId: row.ticket_type_id })),
  };
}

/**
 * Replace the seat plan of a schedule. Each assignment selects seats by ids,
 * by zone, or by zone + rows; selections are resolved against THIS venue's
 * SEATED zones only. A seat may appear in only one assignment.
 */
async function replaceSeatPlan(context, actor, scheduleId, { assignments }) {
  await withTransaction(async (client) => {
    const { event, schedule } = await lockScheduleOfManageableEvent(client, actor, scheduleId);
    assertDraft(event);

    const ticketTypes = await ticketTypesRepository.listBySchedule(client, scheduleId);
    const reservedTypeIds = new Set(
      ticketTypes.filter((tt) => tt.inventory_mode === INVENTORY_MODE.RESERVED).map((tt) => tt.id),
    );

    const rows = [];
    const seen = new Set();
    for (const [index, assignment] of assignments.entries()) {
      const field = `body.assignments.${index}`;
      if (!reservedTypeIds.has(assignment.ticketTypeId)) {
        throw new AppError('SEAT_PLAN_INVALID', undefined, {
          details: [{ field: `${field}.ticketTypeId`, message: 'must be a RESERVED ticket type of this schedule' }],
        });
      }
      const seatIds = await venues.findPlannableSeats(client, {
        venueId: schedule.venue_id,
        seatIds: assignment.seatIds,
        zoneId: assignment.zoneId,
        rows: assignment.rows,
      });
      if (seatIds.length === 0 || (assignment.seatIds && seatIds.length !== new Set(assignment.seatIds).size)) {
        throw new AppError('SEAT_PLAN_INVALID', undefined, {
          details: [{ field, message: 'selects no seats, or seats that are not in a SEATED zone of this venue' }],
        });
      }
      for (const seatId of seatIds) {
        if (seen.has(seatId)) {
          throw new AppError('SEAT_PLAN_INVALID', undefined, {
            details: [{ field, message: 'a seat is assigned to more than one ticket type' }],
          });
        }
        seen.add(seatId);
        rows.push({ seatId, ticketTypeId: assignment.ticketTypeId });
      }
    }
    // PK (schedule_id, seat_id) is the database backstop against double assignment.
    await inventoryRepository.replacePlan(client, scheduleId, rows);
  });
  return getSeatPlan(actor, scheduleId);
}

module.exports = {
  listTicketTypes,
  createTicketType,
  updateTicketType,
  deleteTicketType,
  getSeatPlan,
  replaceSeatPlan,
};
