/**
 * Tickets: one per seat line, N per general-admission line (admission_no 1..N).
 */

const TICKET_COLUMNS = `t.id, t.ticket_code, t.order_id, t.order_item_id, t.user_id, t.event_id, t.schedule_id,
  t.schedule_seat_id, t.admission_no, t.qr_version, t.status, t.issued_at, t.used_at, t.cancelled_at`;

/** The lines to issue tickets for. */
async function orderLines(db, orderId) {
  const { rows } = await db.query(
    `SELECT id AS order_item_id, event_id, schedule_id, schedule_seat_id, quantity
     FROM order_items WHERE order_id = $1 ORDER BY id`,
    [orderId],
  );
  return rows;
}

/**
 * Insert in one statement. ON CONFLICT (order_item_id, admission_no) DO
 * NOTHING: running the same issuance again (retry, reconciliation) adds
 * nothing. uq_tickets_live_seat stays the last line of defence for seats.
 * @returns {Promise<number>} tickets actually created
 */
async function insertTickets(db, tickets) {
  if (tickets.length === 0) return 0;
  const column = (name) => tickets.map((ticket) => ticket[name]);
  const { rowCount } = await db.query(
    `INSERT INTO tickets (id, ticket_code, qr_token_hash, order_id, order_item_id, user_id, event_id, schedule_id,
                          schedule_seat_id, admission_no)
     SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::uuid[], $5::uuid[], $6::uuid[], $7::uuid[],
                          $8::uuid[], $9::uuid[], $10::int[])
     ON CONFLICT (order_item_id, admission_no) DO NOTHING`,
    [
      column('id'),
      column('ticketCode'),
      column('qrTokenHash'),
      column('orderId'),
      column('orderItemId'),
      column('userId'),
      column('eventId'),
      column('scheduleId'),
      column('scheduleSeatId'),
      column('admissionNo'),
    ],
  );
  return rowCount;
}

/** Tickets of an order with what to print on them (seat, ticket type). */
async function listForOrder(db, orderId) {
  const { rows } = await db.query(
    `SELECT ${TICKET_COLUMNS}, oi.seat_label, oi.ticket_type_name
     FROM tickets t
     JOIN order_items oi ON oi.id = t.order_item_id
     WHERE t.order_id = $1
     ORDER BY oi.seat_label NULLS LAST, oi.ticket_type_name, t.admission_no`,
    [orderId],
  );
  return rows;
}

/**
 * Q-04: paid orders that still have no ticket, a while after payment (so the
 * normal job has had its chance). An enqueue lost after COMMIT ends up here.
 */
async function findPaidOrdersWithoutTickets(db, { olderThanSeconds, limit }) {
  const { rows } = await db.query(
    `SELECT o.id FROM orders o
     WHERE o.status = 'PAID' AND o.paid_at <= now() - make_interval(secs => $1)
       AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = o.id)
     ORDER BY o.paid_at
     LIMIT $2`,
    [olderThanSeconds, limit],
  );
  return rows.map((row) => row.id);
}

/** Everything the order confirmation email shows (read model join). */
async function confirmationOf(db, orderId) {
  const { rows } = await db.query(
    `SELECT o.id, o.order_code, o.status, o.total_amount, o.discount_amount, o.currency,
            u.email, u.first_name, u.event_reminders, e.title AS event_title, es.start_at, es.status AS schedule_status,
            v.name AS venue_name, v.address_line AS venue_address, v.city AS venue_city,
            -- Phase 18.3: a customer's cancellation gives back part of it.
            least(o.total_amount, (SELECT coalesce(sum(r.amount), 0) FROM refunds r WHERE r.order_id = o.id))::bigint AS refunded_amount
     FROM orders o
     JOIN users u ON u.id = o.user_id
     JOIN event_schedules es ON es.id = o.schedule_id
     JOIN events e ON e.id = es.event_id
     JOIN venues v ON v.id = es.venue_id
     WHERE o.id = $1`,
    [orderId],
  );
  return rows[0] ?? null;
}

// What a ticket shows: its seat / ticket type, the show and where it is.
const TICKET_VIEW = `${TICKET_COLUMNS}, oi.seat_label, oi.ticket_type_id, oi.ticket_type_name,
  e.title AS event_title, e.organizer_id, es.start_at, es.end_at, es.status AS schedule_status,
  v.name AS venue_name, v.address_line AS venue_address, v.city AS venue_city`;

const TICKET_VIEW_JOINS = `JOIN order_items oi ON oi.id = t.order_item_id
  JOIN event_schedules es ON es.id = t.schedule_id
  JOIN events e ON e.id = t.event_id
  JOIN venues v ON v.id = es.venue_id`;

/**
 * Phase 20: what the ticket PDF prints, for the VALID tickets of an order
 * (or one ticket), seat order: the show, the place, the order and its buyer.
 */
async function pdfTickets(db, { orderId = null, ticketId = null }) {
  const { rows } = await db.query(
    `SELECT ${TICKET_VIEW}, o.order_code, u.first_name, u.last_name
     FROM tickets t ${TICKET_VIEW_JOINS}
     JOIN orders o ON o.id = t.order_id
     JOIN users u ON u.id = t.user_id
     WHERE t.status = 'VALID' AND ($1::uuid IS NULL OR t.order_id = $1) AND ($2::uuid IS NULL OR t.id = $2)
     ORDER BY oi.seat_label NULLS LAST, oi.ticket_type_name, t.admission_no`,
    [orderId, ticketId],
  );
  return rows;
}

/** TKT-01: the user's tickets, next show first, then past ones (most recent first). */
async function listForUser(db, { userId, status, limit, offset }) {
  const { rows } = await db.query(
    `SELECT ${TICKET_VIEW}, count(*) OVER () AS total_count
     FROM tickets t ${TICKET_VIEW_JOINS}
     WHERE t.user_id = $1 AND ($2::ticket_status IS NULL OR t.status = $2)
     ORDER BY (es.end_at < now()), CASE WHEN es.end_at >= now() THEN es.start_at END,
              es.start_at DESC, oi.seat_label NULLS LAST, t.admission_no, t.id
     LIMIT $3 OFFSET $4`,
    [userId, status ?? null, limit, offset],
  );
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

/** One ticket with its show. Ownership is the caller's check. */
async function findView(db, ticketId) {
  const { rows } = await db.query(`SELECT ${TICKET_VIEW} FROM tickets t ${TICKET_VIEW_JOINS} WHERE t.id = $1`, [ticketId]);
  return rows[0] ?? null;
}

/**
 * CHK-01: lock the scanned ticket (only the ticket row: FOR UPDATE OF t).
 * Two gates scanning the same ticket queue up here; the second one then
 * sees it USED.
 */
async function lockViewForCheckIn(db, ticketId) {
  const { rows } = await db.query(
    `SELECT ${TICKET_VIEW}, t.qr_token_hash FROM tickets t ${TICKET_VIEW_JOINS} WHERE t.id = $1 FOR UPDATE OF t`,
    [ticketId],
  );
  return rows[0] ?? null;
}

/** VALID → USED, compare-and-set. @returns {Promise<object|null>} null if it was not VALID any more */
async function markUsed(db, ticketId) {
  const { rows } = await db.query(
    `UPDATE tickets SET status = 'USED', used_at = now() WHERE id = $1 AND status = 'VALID' RETURNING used_at`,
    [ticketId],
  );
  return rows[0] ?? null;
}

/** TKT-03: a new QR version; every copy of the previous QR stops opening the gate. */
async function bumpQrVersion(db, { ticketId, version, qrTokenHash }) {
  await db.query(`UPDATE tickets SET qr_version = $2, qr_token_hash = $3 WHERE id = $1`, [ticketId, version, qrTokenHash]);
}

module.exports = {
  bumpQrVersion,
  orderLines,
  insertTickets,
  listForOrder,
  findPaidOrdersWithoutTickets,
  confirmationOf,
  listForUser,
  findView,
  lockViewForCheckIn,
  markUsed,
  pdfTickets,
};
