const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { EVENT_STATUS, INVENTORY_MODE, ZONE_KIND, SEAT_STATUS, TICKET_TYPE_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { recordAudit } = require('../audit');
const inventoryRepository = require('./inventory.repository');
const schedulesRepository = require('./schedules.repository');
const eventsRepository = require('./events.repository');
const ticketTypesRepository = require('./ticket-types.repository');
const { canView, canManage, eventNotFound, scheduleNotFound, lockScheduleOfManageableEvent } = require('./event-access');
const { remember, invalidatesAfter, NAMESPACE, TTL } = require('../../redis/cache');
const { publishAfterCommit } = require('../../realtime/publisher');
const { MESSAGE, scheduleRoom, seatUpdate, inventoryUpdate } = require('../../realtime/messages');

const toNumberOrNull = (value) => (value === null ? null : Number(value));

// ---------------------------------------------------------------------------
// Used by the event state machine (inside its transaction)
// ---------------------------------------------------------------------------

/**
 * Every SCHEDULED schedule must be sellable: at least one ACTIVE ticket type,
 * and every RESERVED ticket type must have seats in the seat plan.
 */
async function assertSellable(client, eventId) {
  const summary = await inventoryRepository.sellableSummary(client, eventId);
  const withoutTypes = summary.filter((s) => s.active_ticket_types === 0);
  if (withoutTypes.length > 0) {
    throw new AppError('TICKET_TYPES_REQUIRED', undefined, {
      details: withoutTypes.map((s) => ({ field: 'scheduleId', message: `${s.schedule_id} has no active ticket type` })),
    });
  }
  const incomplete = summary.filter((s) => s.reserved_without_seats > 0);
  if (incomplete.length > 0) {
    throw new AppError('SEAT_PLAN_INCOMPLETE', undefined, {
      details: incomplete.map((s) => ({
        field: 'scheduleId',
        message: `${s.schedule_id} has a reserved ticket type with no seats`,
      })),
    });
  }
}

/**
 * Turn the approved configuration into schedule inventory. Runs in the SAME
 * transaction as the approval: either the event is PUBLISHED with its
 * inventory, or neither happened. Idempotent: re-running inserts nothing new.
 */
async function generateInventory(client, eventId) {
  const reservedSeats = await inventoryRepository.generateReservedInventory(client, eventId);
  const gaTicketTypes = await inventoryRepository.generateGaInventory(client, eventId);
  await inventoryRepository.markGenerated(client, eventId);
  return { reservedSeats, gaTicketTypes };
}

/** Admin repair tool: (re)generate inventory for a published event. Safe to repeat. */
async function regenerateInventory(context, actor, scheduleId) {
  return withTransaction(async (client) => {
    const { event } = await lockScheduleOfManageableEvent(client, actor, scheduleId);
    if (event.status !== EVENT_STATUS.PUBLISHED) {
      throw new AppError('EVENT_NOT_EDITABLE', 'Inventory is generated for PUBLISHED events only.');
    }
    const created = await generateInventory(client, event.id);
    await recordAudit(client, {
      context,
      action: 'INVENTORY_GENERATED',
      entityType: 'event',
      entityId: event.id,
      newValue: { ...created, trigger: 'manual' },
    });
    return created;
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function loadViewableSchedule(actor, scheduleId) {
  const schedule = await schedulesRepository.findById(pool, scheduleId);
  if (!schedule) throw scheduleNotFound();
  const event = await eventsRepository.findById(pool, schedule.event_id);
  if (!canView(actor, event)) throw eventNotFound();
  if (!schedule.inventory_generated_at) throw new AppError('INVENTORY_NOT_GENERATED');
  return { event, schedule };
}

function toAvailability(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    price: row.price,
    currency: row.currency,
    inventoryMode: row.inventory_mode,
    status: row.status,
    maxPerOrder: row.max_per_order,
    venueZoneId: row.venue_zone_id,
    total: row.total,
    available: row.available,
  };
}

/** The "choose a ticket class and quantity" step. Paused types are hidden from the public. */
async function getAvailability(actor, scheduleId) {
  const { event, schedule } = await loadViewableSchedule(actor, scheduleId);
  const rows = await inventoryRepository.availabilityBySchedule(pool, scheduleId);
  const visible = canManage(actor, event) ? rows : rows.filter((row) => row.status === TICKET_TYPE_STATUS.ACTIVE);
  return { scheduleId: schedule.id, ticketTypes: visible.map(toAvailability) };
}

/** Zones and seats of a schedule without any status: cacheable, it does not change after publishing. */
async function loadSeatMapLayout(scheduleId) {
  const [zones, seats] = await Promise.all([
    inventoryRepository.zonesForSchedule(pool, scheduleId),
    inventoryRepository.seatLayoutRows(pool, scheduleId),
  ]);
  return zones.map((zone) => ({
    id: zone.id,
    code: zone.code,
    name: zone.name,
    kind: zone.kind,
    capacity: zone.capacity,
    seats:
      zone.kind === ZONE_KIND.SEATED
        ? seats
            .filter((seat) => seat.venue_zone_id === zone.id)
            .map((seat) => ({
              seatId: seat.seat_id,
              code: seat.seat_code,
              rowLabel: seat.row_label,
              seatNumber: seat.seat_number,
              seatType: seat.seat_type,
              x: toNumberOrNull(seat.x),
              y: toNumberOrNull(seat.y),
              ticketTypeId: seat.ticket_type_id,
              price: seat.price,
            }))
        : [],
  }));
}

/**
 * Seat map = layout from the cache (1 hour) + seat statuses and remaining
 * tickets from PostgreSQL (always fresh).
 */
async function getSeatMap(actor, scheduleId) {
  const { schedule } = await loadViewableSchedule(actor, scheduleId);
  const [layout, statuses, availability] = await Promise.all([
    remember(NAMESPACE.CATALOG, `seatmap:${scheduleId}`, TTL.SEAT_MAP_LAYOUT, () => loadSeatMapLayout(scheduleId)),
    inventoryRepository.seatStatuses(pool, scheduleId),
    inventoryRepository.availabilityBySchedule(pool, scheduleId),
  ]);
  const statusBySeat = new Map(statuses.map((row) => [row.seat_id, row]));

  return {
    scheduleId: schedule.id,
    ticketTypes: availability.map(toAvailability),
    zones: layout.map((zone) => ({
      ...zone,
      seats: zone.seats.map((seat) => ({
        ...seat,
        status: statusBySeat.get(seat.seatId)?.status,
        version: statusBySeat.get(seat.seatId)?.version, // lets real-time clients drop out-of-order updates (Phase 7)
      })),
      generalAdmission:
        zone.kind === ZONE_KIND.STANDING
          ? availability
              .filter((tt) => tt.venue_zone_id === zone.id)
              .map((tt) => ({ ticketTypeId: tt.id, available: tt.available, total: tt.total }))
          : [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Block / unblock (owner organizer or admin, reason required, audited)
// ---------------------------------------------------------------------------

async function changeSeatBlocks(client, { scheduleId, action, seatIds, reason }) {
  const uniqueIds = [...new Set(seatIds)].sort();
  const locked = await inventoryRepository.lockScheduleSeats(client, scheduleId, uniqueIds);
  const statusById = Object.fromEntries(locked.map((row) => [row.seat_id, row.status]));
  const required = action === 'BLOCK' ? SEAT_STATUS.AVAILABLE : SEAT_STATUS.BLOCKED;

  const applied = uniqueIds.filter((id) => statusById[id] === required);
  const rejected = uniqueIds
    .filter((id) => statusById[id] !== required)
    .map((id) => ({ seatId: id, status: statusById[id] ?? 'NOT_IN_INVENTORY' }));

  if (applied.length > 0) {
    const changed =
      action === 'BLOCK'
        ? await inventoryRepository.blockSeats(client, scheduleId, applied, reason)
        : await inventoryRepository.unblockSeats(client, scheduleId, applied);
    // One message for the whole batch: blocking 50 seats is one update, not 50.
    const type = action === 'BLOCK' ? MESSAGE.SEAT_BLOCKED : MESSAGE.SEAT_RELEASED;
    publishAfterCommit(client, scheduleRoom(scheduleId), seatUpdate(type, scheduleId, changed));
  }
  return { applied, rejected };
}

async function changeGaBlock(client, { scheduleId, action, ticketTypeId, quantity }) {
  const ticketType = await ticketTypesRepository.findById(client, ticketTypeId);
  if (!ticketType || ticketType.schedule_id !== scheduleId) {
    throw new AppError('NOT_FOUND', 'Ticket type not found.');
  }
  if (ticketType.inventory_mode !== INVENTORY_MODE.GENERAL_ADMISSION) {
    throw new AppError('TICKET_TYPE_INVALID', 'Use seatIds to block reserved seats.');
  }
  const counters =
    action === 'BLOCK'
      ? await inventoryRepository.blockGa(client, { ticketTypeId, quantity })
      : await inventoryRepository.unblockGa(client, { ticketTypeId, quantity });
  if (!counters) {
    throw new AppError('INSUFFICIENT_INVENTORY', action === 'BLOCK'
      ? 'Not enough available tickets to block.'
      : 'Not that many tickets are blocked.');
  }
  publishAfterCommit(client, scheduleRoom(scheduleId), inventoryUpdate(scheduleId, [counters]));
  return {
    ticketTypeId,
    quantity,
    available: counters.available,
    blocked: counters.blocked_quantity,
  };
}

async function changeBlocks(context, actor, scheduleId, body) {
  return withTransaction(async (client) => {
    const { event, schedule } = await lockScheduleOfManageableEvent(client, actor, scheduleId);
    if (event.status !== EVENT_STATUS.PUBLISHED) {
      throw new AppError('EVENT_NOT_EDITABLE', 'Inventory can be blocked only while the event is PUBLISHED.');
    }
    if (!schedule.inventory_generated_at) {
      throw new AppError('INVENTORY_NOT_GENERATED');
    }

    const result = body.seatIds
      ? await changeSeatBlocks(client, { scheduleId, ...body })
      : await changeGaBlock(client, { scheduleId, ...body });

    const changedSomething = !body.seatIds || result.applied.length > 0;
    if (changedSomething) {
      await recordAudit(client, {
        context,
        action: body.action === 'BLOCK' ? 'INVENTORY_BLOCKED' : 'INVENTORY_UNBLOCKED',
        entityType: 'event_schedule',
        entityId: scheduleId,
        newValue: body.seatIds
          ? { seatIds: result.applied, reason: body.reason }
          : { ticketTypeId: body.ticketTypeId, quantity: body.quantity, reason: body.reason },
      });
    }
    return result;
  });
}

module.exports = {
  assertSellable,
  generateInventory,
  regenerateInventory: invalidatesAfter([NAMESPACE.CATALOG], regenerateInventory),
  getAvailability,
  getSeatMap,
  changeBlocks,
};
