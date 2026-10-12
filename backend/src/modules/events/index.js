/**
 * Public API of the events module for other modules (the orders module books
 * and releases inventory through these). Does not load events.service, so the
 * events service may itself depend on the orders module without a cycle.
 */
const { lockScheduleForSale, PUBLIC_STATUSES, resolveActor, canManage } = require('./event-access');
const staffRepository = require('./staff.repository');
const inventoryRepository = require('./inventory.repository');
const ticketTypesRepository = require('./ticket-types.repository');
const schedulesRepository = require('./schedules.repository');
const eventsRepository = require('./events.repository');
const { pool } = require('../../database/pool');
const { finishPastShows } = require('./lifecycle');

/**
 * A schedule whose seat map anyone may watch live (WebSocket SUBSCRIBE):
 * its event is public and its inventory exists. Otherwise null, so a DRAFT
 * event's schedules cannot even be confirmed to exist.
 */
async function findWatchableSchedule(scheduleId) {
  const schedule = await schedulesRepository.findById(pool, scheduleId);
  if (!schedule || !schedule.inventory_generated_at) return null;
  const event = await eventsRepository.findById(pool, schedule.event_id);
  return event && PUBLIC_STATUSES.includes(event.status) ? schedule : null;
}

module.exports = {
  PUBLIC_STATUSES,
  resolveActor,
  canManage,
  findEventById: (db, eventId) => eventsRepository.findById(db, eventId),
  findScheduleById: (db, scheduleId) => schedulesRepository.findById(db, scheduleId),
  isEventStaff: (db, eventId, userId) => staffRepository.isStaff(db, { eventId, userId }),
  eventAudience: staffRepository.audienceOf,
  findWatchableSchedule,
  finishPastShows,
  lockScheduleForSale,
  listTicketTypes: ticketTypesRepository.listBySchedule,
  lockSeatsForHold: inventoryRepository.lockSeatsForHold,
  holdSeats: inventoryRepository.holdSeats,
  releaseSeatsOfOrder: inventoryRepository.releaseSeatsOfOrder,
  holdGa: inventoryRepository.holdGa,
  releaseGa: inventoryRepository.releaseGa,
  gaAvailable: inventoryRepository.gaAvailable,
  extendHoldsOfOrder: inventoryRepository.extendHoldsOfOrder,
  sellSeatsOfOrder: inventoryRepository.sellSeatsOfOrder,
  refundSeatsOfOrder: inventoryRepository.refundSeatsOfOrder,
  sellGa: inventoryRepository.sellGa,
  refundGa: inventoryRepository.refundGa,
};
