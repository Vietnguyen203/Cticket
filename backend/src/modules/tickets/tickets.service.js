const { randomInt, randomUUID } = require('node:crypto');
const QRCode = require('qrcode');
const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { ORDER_STATUS, TICKET_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { recordAudit } = require('../audit');
const { toLimitOffset, toPageMeta } = require('../../utils/pagination');
const orders = require('../orders');
const { QUEUE, enqueue, enqueueAfterCommit } = require('../../queue/queues');
const { publishAfterCommit } = require('../../realtime/publisher');
const { MESSAGE, userRoom } = require('../../realtime/messages');
const ticketsRepository = require('./tickets.repository');
const { qrToken, qrTokenHash } = require('./qr');
const { renderTicketsPdf } = require('./ticket-pdf');
const logger = require('../../utils/logger');
const mailer = require('../../mail/mailer');
const { ticketQrReissuedEmail } = require('../../mail/templates');

// Read out loud at the gate when a QR will not scan: no 0/O or 1/I.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10; // 32^10 ≈ 10^15
const FIRST_QR_VERSION = 1;
const RECONCILE_AFTER_SECONDS = 60;
const RECONCILE_BATCH = 100;
const QR_PNG_OPTIONS = { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 320 };
// A refunded / cancelled ticket shows no QR: there is nothing left to scan.
const SCANNABLE = [TICKET_STATUS.VALID, TICKET_STATUS.USED];

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

/** A ticket in "My tickets" (TKT-01): what it is for, never who bought it. */
function toTicketView(row) {
  return {
    ...toTicket(row),
    ticketTypeId: row.ticket_type_id,
    event: { id: row.event_id, title: row.event_title },
    schedule: { id: row.schedule_id, startAt: row.start_at, endAt: row.end_at, status: row.schedule_status },
    venue: { name: row.venue_name, address: row.venue_address, city: row.venue_city },
    orderId: row.order_id,
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

async function listMine(userId, { status, page, pageSize }) {
  const { rows, total } = await ticketsRepository.listForUser(pool, { userId, status, ...toLimitOffset({ page, pageSize }) });
  return { tickets: rows.map(toTicketView), meta: toPageMeta({ page, pageSize }, total) };
}

/** Only the owner sees a ticket; anyone else gets 404 (we do not confirm it exists). */
async function findOwnTicket(userId, ticketId) {
  const row = await ticketsRepository.findView(pool, ticketId);
  if (!row || row.user_id !== userId) throw new AppError('NOT_FOUND', 'Ticket not found.');
  return row;
}

/** TKT-02: the ticket plus its QR content (qrToken), for the app to draw. */
async function getMine(userId, ticketId) {
  const row = await findOwnTicket(userId, ticketId);
  return {
    ...toTicketView(row),
    qrToken: SCANNABLE.includes(row.status) ? qrToken(row.id, row.qr_version) : null,
  };
}

/** TKT-02: the same QR as a PNG image (emails, simple web pages). */
async function qrPngOfMine(userId, ticketId) {
  const row = await findOwnTicket(userId, ticketId);
  if (!SCANNABLE.includes(row.status)) throw new AppError('TICKET_NOT_VALID', 'This ticket has no QR code any more.');
  return QRCode.toBuffer(qrToken(row.id, row.qr_version), QR_PNG_OPTIONS);
}

/**
 * TKT-03: the customer's QR leaked (a shared screenshot…). Same row lock as a
 * check-in, so it cannot interleave with a scan of the old code at a gate.
 */
async function reissueQr(context, ticketId) {
  return withTransaction(async (client) => {
    const ticket = await ticketsRepository.lockViewForCheckIn(client, ticketId);
    if (!ticket) throw new AppError('NOT_FOUND', 'Ticket not found.');
    if (ticket.status !== TICKET_STATUS.VALID) throw new AppError('TICKET_NOT_REISSUABLE');
    const version = ticket.qr_version + 1;
    await ticketsRepository.bumpQrVersion(client, { ticketId, version, qrTokenHash: qrTokenHash(qrToken(ticketId, version)) });
    await recordAudit(client, {
      context,
      action: 'TICKET_QR_REISSUED',
      entityType: 'ticket',
      entityId: ticketId,
      oldValue: { qrVersion: ticket.qr_version },
      newValue: { qrVersion: version },
    });
    // Phase 20: the customer gets the new QR (and its PDF) by email.
    enqueueAfterCommit(client, QUEUE.EMAILS, 'ticket-qr-reissued', { ticketId }, { jobId: `ticket-qr-${ticketId}-${version}` });
    return toTicketView({ ...ticket, qr_version: version });
  });
}

// ---------------------------------------------------------------------------
// Phase 20: tickets as PDF (made on demand, never stored)
// ---------------------------------------------------------------------------

const noValidTicket = () => new AppError('TICKET_NOT_VALID', 'There is no valid ticket to print.');

/** GET /orders/:id/tickets.pdf: the valid tickets of my order. */
async function orderPdfOfMine(userId, orderId) {
  const order = (await pool.query(`SELECT user_id, order_code FROM orders WHERE id = $1`, [orderId])).rows[0];
  if (!order || order.user_id !== userId) throw new AppError('NOT_FOUND', 'Order not found.');
  const rows = await ticketsRepository.pdfTickets(pool, { orderId });
  if (rows.length === 0) throw noValidTicket();
  return { filename: `Ve-${order.order_code}.pdf`, pdf: await renderTicketsPdf(rows, { title: `Vé đơn ${order.order_code}` }) };
}

/** GET /tickets/:id/ticket.pdf: one of my valid tickets. */
async function ticketPdfOfMine(userId, ticketId) {
  const own = await findOwnTicket(userId, ticketId);
  const rows = await ticketsRepository.pdfTickets(pool, { ticketId });
  if (rows.length === 0) throw noValidTicket();
  return { filename: `Ve-${own.ticket_code}.pdf`, pdf: await renderTicketsPdf(rows, { title: `Vé ${own.ticket_code}` }) };
}

/**
 * For emails: the order's PDF as an attachment, or null if it cannot be made
 * (logged): the email is sent anyway, a confirmation never waits on a PDF.
 */
async function pdfAttachment({ orderId = null, ticketId = null, filename }) {
  try {
    const rows = await ticketsRepository.pdfTickets(pool, { orderId, ticketId });
    if (rows.length === 0) return null;
    return { filename, content: await renderTicketsPdf(rows), contentType: 'application/pdf' };
  } catch (err) {
    logger.error({ err, orderId, ticketId }, 'Ticket PDF could not be made; the email goes without it');
    return null;
  }
}

/** Emails queue: "your ticket has a new QR", with its PDF. */
async function sendQrReissuedEmail({ ticketId }) {
  const row = await ticketsRepository.findView(pool, ticketId);
  if (!row || row.status !== TICKET_STATUS.VALID) return 'skipped';
  const { rows } = await pool.query(`SELECT email, first_name FROM users WHERE id = $1`, [row.user_id]);
  const attachment = await pdfAttachment({ ticketId, filename: `Ve-${row.ticket_code}.pdf` });
  await mailer.sendMail({
    to: rows[0].email,
    ...ticketQrReissuedEmail({ firstName: rows[0].first_name, code: row.ticket_code, eventTitle: row.event_title }),
    attachments: attachment ? [attachment] : [],
  });
  return 'sent';
}

module.exports = {
  reissueQr,
  issueTicketsForOrder,
  reconcileTickets,
  listForOrder,
  confirmationOf,
  toTicket,
  toTicketView,
  listMine,
  getMine,
  qrPngOfMine,
  orderPdfOfMine,
  ticketPdfOfMine,
  pdfAttachment,
  sendQrReissuedEmail,
};
