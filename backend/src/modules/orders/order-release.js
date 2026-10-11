const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { ORDER_STATUS, CANCEL_REASON, ORDER_LIMITS } = require('../../config/constants');
const events = require('../events');
const { publishAfterCommit } = require('../../realtime/publisher');
const { MESSAGE, scheduleRoom, userRoom, seatUpdate, inventoryUpdate } = require('../../realtime/messages');
const ordersRepository = require('./orders.repository');

/**
 * End a HELD order and put its inventory back on sale, in the caller's
 * transaction. Used by cancel, expiry and event cancellation alike.
 *
 * Lock order: the order row (compare-and-set) → its seats (by seat_id) → GA
 * counters (by ticket_type_id), the same order as the booking flow.
 *
 * @returns {Promise<boolean>} false if the order was no longer HELD (someone
 *   else already ended it, and already released its inventory)
 */
async function releaseHeldOrder(client, orderId, { to, cancelReason = null }) {
  const changed = await ordersRepository.transition(client, { orderId, from: ORDER_STATUS.HELD, to, cancelReason });
  if (!changed) return false;

  const seats = await events.releaseSeatsOfOrder(client, orderId);
  const counters = [];
  for (const line of await ordersRepository.gaLines(client, orderId)) {
    const counter = await events.releaseGa(client, line);
    if (!counter) {
      // held_quantity smaller than this order's hold: the counters are out of
      // sync. Roll back rather than hide it; inventory:check will show where.
      throw new Error(`GA counter of ticket type ${line.ticketTypeId} is lower than the quantity being released`);
    }
    counters.push(counter);
  }

  // Live seat maps and the order's owner hear about it once this commits.
  const room = scheduleRoom(changed.schedule_id);
  if (seats.length > 0) publishAfterCommit(client, room, seatUpdate(MESSAGE.SEAT_RELEASED, changed.schedule_id, seats));
  if (counters.length > 0) publishAfterCommit(client, room, inventoryUpdate(changed.schedule_id, counters));
  publishAfterCommit(client, userRoom(changed.user_id), {
    type: to === ORDER_STATUS.EXPIRED ? MESSAGE.ORDER_EXPIRED : MESSAGE.ORDER_CANCELLED,
    orderId,
    reason: cancelReason,
  });
  return true;
}

/**
 * Expire one order if it is HELD and its time is up, in its own transaction.
 * SKIP LOCKED: if another sweeper or a cancel is working on it, leave it to them.
 * @returns {Promise<boolean>} true if this call expired it
 */
function expireOrder(orderId) {
  return withTransaction(async (client) => {
    if (!(await ordersRepository.lockDueOrder(client, orderId))) return false;
    return releaseHeldOrder(client, orderId, { to: ORDER_STATUS.EXPIRED });
  });
}

/**
 * Expire HELD orders whose time is up. Each order gets its own short
 * transaction, locked with SKIP LOCKED, so several API instances (or a
 * sweeper and a lazy clean-up) can run this at once without double work.
 * @returns {Promise<number>} orders expired
 */
async function expireDueOrders({ scheduleId = null, userId = null } = {}) {
  let expired = 0;
  for (;;) {
    const ids = await ordersRepository.findDueOrderIds(pool, {
      scheduleId,
      userId,
      limit: ORDER_LIMITS.EXPIRE_BATCH_SIZE,
    });
    let expiredInBatch = 0;
    for (const id of ids) {
      if (await expireOrder(id)) expiredInBatch += 1;
    }
    expired += expiredInBatch;
    // A full batch may mean more are due. Orders skipped because someone else
    // holds them are left to that request, so stop when a batch made no progress.
    if (ids.length < ORDER_LIMITS.EXPIRE_BATCH_SIZE || expiredInBatch === 0) return expired;
  }
}

/**
 * Event or schedule cancellation: cancel every HELD order of it in the
 * caller's transaction. The caller already holds the event row FOR UPDATE, so
 * no booking (which needs it FOR SHARE) can add a hold meanwhile.
 * Paid orders are refunded in Phase 8.
 * @returns {Promise<number>} orders cancelled
 */
async function cancelHeldOrders(client, scope, cancelReason) {
  let cancelled = 0;
  for (const id of await ordersRepository.lockHeldOrders(client, scope)) {
    const done = await releaseHeldOrder(client, id, { to: ORDER_STATUS.CANCELLED, cancelReason });
    if (done) cancelled += 1;
  }
  return cancelled;
}

const cancelHeldOrdersOfEvent = (client, eventId) =>
  cancelHeldOrders(client, { eventId }, CANCEL_REASON.EVENT_CANCELLED);
const cancelHeldOrdersOfSchedule = (client, scheduleId) =>
  cancelHeldOrders(client, { scheduleId }, CANCEL_REASON.SCHEDULE_CANCELLED);

module.exports = {
  releaseHeldOrder,
  expireOrder,
  expireDueOrders,
  cancelHeldOrdersOfEvent,
  cancelHeldOrdersOfSchedule,
};
