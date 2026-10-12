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
            u.email, u.first_name, e.title AS event_title, es.start_at, v.name AS venue_name
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

module.exports = { orderLines, insertTickets, listForOrder, findPaidOrdersWithoutTickets, confirmationOf };
