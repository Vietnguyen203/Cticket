const { randomInt, randomUUID } = require('node:crypto');
const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { ORDER_STATUS } = require('../../config/constants');
const orders = require('../orders');
const { QUEUE, enqueue, enqueueAfterCommit } = require('../../queue/queues');
const { publishAfterCommit } = require('../../realtime/publisher');
const { MESSAGE, userRoom } = require('../../realtime/messages');
const ticketsRepository = require('./tickets.repository');
const { qrToken, qrTokenHash } = require('./qr');

// Read out loud at the gate when a QR will not scan: no 0/O or 1/I.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10; // 32^10 ≈ 10^15
const FIRST_QR_VERSION = 1;
const RECONCILE_AFTER_SECONDS = 60;
const RECONCILE_BATCH = 100;

function ticketCode() {
  let code = 'TKT-';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

function toTicket(row) {
  return {
    id: row.id,
    code: row.ticket_code,
    seatLabel: row.seat_label,
    ticketTypeName: row.ticket_type_name,
    admissionNo: row.admission_no,
    status: row.status,
    issuedAt: row.issued_at,
    usedAt: row.used_at,
  };
}

/**
 * Q-01: issue the tickets of a PAID order. Safe to run any number of times:
 * an order that is not PAID (refunded meanwhile, already completed) gets
 * nothing, and existing tickets are never duplicated (unique
 * (order_item_id, admission_no)). A seat line gives one ticket, a GA line
 * of quantity N gives tickets 1..N.
 *
 * Once committed: confirmation email with the ticket codes + in-app notification.
 * @returns {Promise<number>} tickets created by this run
 */
async function issueTicketsForOrder(orderId) {
  return withTransaction(async (client) => {
    const order = await orders.lockOrder(client, orderId);
    if (!order || order.status !== ORDER_STATUS.PAID) return 0;

    const tickets = (await ticketsRepository.orderLines(client, orderId)).flatMap((line) =>
      Array.from({ length: line.quantity }, (_, index) => {
        const id = randomUUID();
        return {
          id,
          ticketCode: ticketCode(),
          qrTokenHash: qrTokenHash(qrToken(id, FIRST_QR_VERSION)),
          orderId,
          orderItemId: line.order_item_id,
          userId: order.user_id,
          eventId: line.event_id,
          scheduleId: line.schedule_id,
          scheduleSeatId: line.schedule_seat_id,
          admissionNo: index + 1,
        };
      }),
    );
    const created = await ticketsRepository.insertTickets(client, tickets);

    if (created > 0) {
      enqueueAfterCommit(client, QUEUE.EMAILS, 'order-confirmed', { orderId }, { jobId: `order-confirmed-${orderId}` });
      enqueueAfterCommit(client, QUEUE.NOTIFICATIONS, 'notify', {
        userId: order.user_id,
        type: 'TICKET_ISSUED',
        data: { orderId, orderCode: order.order_code, ticketCount: tickets.length },
      });
      publishAfterCommit(client, userRoom(order.user_id), { type: MESSAGE.TICKET_ISSUED, orderId, ticketCount: tickets.length });
    }
    return created;
  });
}

/**
 * Q-04: paid orders that still have no ticket a minute after payment (the
 * enqueue after COMMIT was lost, e.g. Redis was down) get their issue job again.
 * @returns {Promise<number>} orders re-queued
 */
async function reconcileTickets() {
  const ids = await ticketsRepository.findPaidOrdersWithoutTickets(pool, {
    olderThanSeconds: RECONCILE_AFTER_SECONDS,
    limit: RECONCILE_BATCH,
  });
  for (const orderId of ids) {
    await enqueue(QUEUE.TICKETS, 'issue', { orderId }, { jobId: `issue-${orderId}-reconcile-${Date.now()}` });
  }
  return ids.length;
}

async function listForOrder(db, orderId) {
  return (await ticketsRepository.listForOrder(db, orderId)).map(toTicket);
}

/** What the confirmation email shows: the order and its tickets. */
async function confirmationOf(orderId) {
  const order = await ticketsRepository.confirmationOf(pool, orderId);
  if (!order) return null;
  return { order, tickets: await listForOrder(pool, orderId) };
}

module.exports = { issueTicketsForOrder, reconcileTickets, listForOrder, confirmationOf, toTicket };
