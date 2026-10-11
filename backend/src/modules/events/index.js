/**
 * Public API of the events module for other modules (the orders module books
 * and releases inventory through these). Does not load events.service, so the
 * events service may itself depend on the orders module without a cycle.
 */
const { lockScheduleForSale, PUBLIC_STATUSES } = require('./event-access');
const inventoryRepository = require('./inventory.repository');
const ticketTypesRepository = require('./ticket-types.repository');

module.exports = {
  PUBLIC_STATUSES,
  lockScheduleForSale,
  listTicketTypes: ticketTypesRepository.listBySchedule,
  lockSeatsForHold: inventoryRepository.lockSeatsForHold,
  holdSeats: inventoryRepository.holdSeats,
  releaseSeatsOfOrder: inventoryRepository.releaseSeatsOfOrder,
  holdGa: inventoryRepository.holdGa,
  releaseGa: inventoryRepository.releaseGa,
  gaAvailable: inventoryRepository.gaAvailable,
};
