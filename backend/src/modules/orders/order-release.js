const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { ORDER_STATUS, ACTIVE_ORDER_STATUSES, CANCEL_REASON, ORDER_LIMITS } = require('../../config/constants');
const events = require('../events');
const promotions = require('../promotions');
const { publishAfterCommit } = require('../../realtime/publisher');
const { MESSAGE, scheduleRoom, userRoom, seatUpdate, inventoryUpdate } = require('../../realtime/messages');
const { QUEUE, enqueueAfterCommit } = require('../../queue/queues');
const ordersRepository = require('./orders.repository');
const { forgetTakenSeatsAfterCommit } = require('./fast-path');
const purchaseQueue = require('../purchase-queue');

/**
 * End an open (unpaid) order — HELD, PAYMENT_PENDING or PAYMENT_FAILED — and
 * put its inventory back on sale, in the caller's transaction. Used by
 * cancel, expiry and event / schedule cancellation alike.
 *
 * Lock order: the order row (compare-and-set) → its seats (by seat_id) → GA
 * counters (by ticket_type_id) → the promotion row, the same order as
 * booking, checkout and payment.
 *
 * @returns {Promise<boolean>} false if the order was no longer open (someone
 *   else already ended or paid it, and already dealt with its inventory)
 */
async function releaseHeldOrder(client, orderId, { to, cancelReason = null }) {
  const changed = await ordersRepository.transition(client, { orderId, from: ACTIVE_ORDER_STATUSES, to, cancelReason });
  if (!changed) return false;

  const seats = await events.releaseSeatsOfOrder(client, orderId);
  forgetTakenSeatsAfterCommit(client, changed.schedule_id, seats.map((seat) => seat.seat_id));
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
  // A promotion use taken at checkout goes back to the code: it was never paid for.
  await promotions.returnUsesOfOrder(client, orderId);
  // Phase 17: an unfinished VNPay attempt goes with the order.
  await ordersRepository.cancelPendingPaymentsOfOrder(client, orderId);

  // Live seat maps and the order's owner hear about it once this commits.
  const room = scheduleRoom(changed.schedule_id);
  if (seats.length > 0) publishAfterCommit(client, room, seatUpdate(MESSAGE.SEAT_RELEASED, changed.schedule_id, seats));
  if (counters.length > 0) publishAfterCommit(client, room, inventoryUpdate(changed.schedule_id, counters));
  const type = to === ORDER_STATUS.EXPIRED ? MESSAGE.ORDER_EXPIRED : MESSAGE.ORDER_CANCELLED;
  publishAfterCommit(client, userRoom(changed.user_id), { type, orderId, reason: cancelReason });
  enqueueAfterCommit(client, QUEUE.NOTIFICATIONS, 'notify', {
    userId: changed.user_id,
    type,
    data: { orderId, orderCode: changed.order_code, reason: cancelReason },
  });
  // Phase 21: the buyer's turn in the purchase queue ends with the order.
  purchaseQueue.releaseTurnAfterCommit(client, { userId: changed.user_id, scheduleId: changed.schedule_id });
  return true;
}

/**
 * Expire one order if it is still open and its time is up, in its own transaction.
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
 * Expire open orders whose time is up. Each order gets its own short
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
 * Event or schedule cancellation: cancel every open order of it in the
 * caller's transaction. The caller already holds the event row FOR UPDATE, so
 * no booking (which needs it FOR SHARE) can add a hold meanwhile.
 * Paid orders are refunded by the payments module in the same transaction.
 * @returns {Promise<number>} orders cancelled
 */
async function cancelHeldOrders(client, scope, cancelReason) {
  let cancelled = 0;
  for (const id of await ordersRepository.lockOrdersOf(client, scope, ACTIVE_ORDER_STATUSES)) {
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
