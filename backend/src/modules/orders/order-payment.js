const { ORDER_STATUS } = require('../../config/constants');
const events = require('../events');
const { publishAfterCommit } = require('../../realtime/publisher');
const { MESSAGE, scheduleRoom, userRoom, seatUpdate, inventoryUpdate } = require('../../realtime/messages');
const { QUEUE, enqueueAfterCommit } = require('../../queue/queues');
const ordersRepository = require('./orders.repository');
const { forgetTakenSeatsAfterCommit } = require('./fast-path');

/**
 * Order state changes driven by payments (Phase 8). All run in the caller's
 * transaction, which already holds the order row FOR UPDATE; then, as for
 * holds: seats in seat_id order → GA counters in ticket_type_id order.
 */

const PAYABLE = [ORDER_STATUS.PAYMENT_PENDING, ORDER_STATUS.PAYMENT_FAILED];

function countersOutOfSync(line) {
  // The counters disagree with the order lines: roll back rather than hide
  // it (inventory:check shows where).
  return new Error(`GA counter of ticket type ${line.ticketTypeId} does not cover this order's ${line.quantity} tickets`);
}

/**
 * Paid (or a 0đ checkout): PAID, seats HELD → SOLD, GA held → sold.
 * @returns {Promise<object|null>} null if the order was no longer payable
 */
async function markOrderPaid(client, orderId) {
  const changed = await ordersRepository.transition(client, { orderId, from: PAYABLE, to: ORDER_STATUS.PAID });
  if (!changed) return null;

  const seats = await events.sellSeatsOfOrder(client, orderId);
  for (const line of await ordersRepository.gaLines(client, orderId)) {
    if (!(await events.sellGa(client, line))) throw countersOutOfSync(line);
  }

  // GA availability does not change (held → sold); seats turn SOLD on live maps.
  if (seats.length > 0) {
    publishAfterCommit(client, scheduleRoom(changed.schedule_id), seatUpdate(MESSAGE.SEAT_SOLD, changed.schedule_id, seats));
  }
  publishAfterCommit(client, userRoom(changed.user_id), { type: MESSAGE.ORDER_PAID, orderId });
  // Q-01: the worker issues the tickets (and then emails them). If this
  // enqueue is lost, the reconciliation job finds the order a minute later.
  enqueueAfterCommit(client, QUEUE.TICKETS, 'issue', { orderId }, { jobId: `issue-${orderId}` });
  return changed;
}

/** The payment was declined: the order keeps its seats until it expires, and can be paid again (PAY-04). */
function markPaymentFailed(client, orderId) {
  return ordersRepository.transition(client, { orderId, from: PAYABLE, to: ORDER_STATUS.PAYMENT_FAILED });
}

/**
 * Refund (PAY-05): REFUNDED, sold seats and GA tickets back on sale, issued
 * tickets refunded. The payment row is handled by the payments module.
 * @returns {Promise<object|null>} null if the order was not PAID
 */
async function refundPaidOrder(client, orderId, { refundAmount } = {}) {
  const changed = await ordersRepository.transition(client, {
    orderId,
    from: [ORDER_STATUS.PAID],
    to: ORDER_STATUS.REFUNDED,
  });
  if (!changed) return null;

  const seats = await events.refundSeatsOfOrder(client, orderId);
  forgetTakenSeatsAfterCommit(client, changed.schedule_id, seats.map((seat) => seat.seat_id));
  const counters = [];
  for (const line of await ordersRepository.gaLines(client, orderId)) {
    const counter = await events.refundGa(client, line);
    if (!counter) throw countersOutOfSync(line);
    counters.push(counter);
  }
  await ordersRepository.refundTicketsOfOrder(client, orderId);

  const room = scheduleRoom(changed.schedule_id);
  if (seats.length > 0) publishAfterCommit(client, room, seatUpdate(MESSAGE.SEAT_RELEASED, changed.schedule_id, seats));
  if (counters.length > 0) publishAfterCommit(client, room, inventoryUpdate(changed.schedule_id, counters));
  publishAfterCommit(client, userRoom(changed.user_id), { type: MESSAGE.ORDER_REFUNDED, orderId });
  enqueueAfterCommit(client, QUEUE.EMAILS, 'order-refunded', { orderId }, { jobId: `order-refunded-${orderId}` });
  enqueueAfterCommit(client, QUEUE.NOTIFICATIONS, 'notify', {
    userId: changed.user_id,
    type: MESSAGE.ORDER_REFUNDED,
    data: { orderId, orderCode: changed.order_code, amount: refundAmount ?? changed.total_amount },
  });
  return changed;
}

/** Phase 10: the customer has been in (a ticket is USED), so the order can no longer be refunded on request. */
function hasCheckedInTickets(client, orderId) {
  return ordersRepository.lockTicketsHasUsed(client, orderId);
}

/** Lock an order for a payment or a refund (the first lock of those flows). */
function lockOrder(client, orderId) {
  return ordersRepository.findById(client, orderId, { forUpdate: true });
}

/** PAID orders of an event / schedule being cancelled, locked in id order. */
function lockPaidOrders(client, scope) {
  return ordersRepository.lockOrdersOf(client, scope, [ORDER_STATUS.PAID]);
}

module.exports = {
  markOrderPaid,
  markPaymentFailed,
  refundPaidOrder,
  hasCheckedInTickets,
  lockOrder,
  lockPaidOrders,
  PAYABLE,
};
