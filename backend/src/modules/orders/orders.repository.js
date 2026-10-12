/**
 * Orders and order lines. Times are compared with the DATABASE clock (now()),
 * never the API server's, so every replica agrees on when a hold expires.
 */

// Orders that still hold inventory (same list as uq_orders_active_cart and ACTIVE_ORDER_STATUSES).
const OPEN = `('HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED')`;

const ORDER_COLUMNS = `o.id, o.order_code, o.user_id, o.schedule_id, o.status, o.subtotal, o.discount_amount,
  o.total_amount, o.currency, o.expires_at, o.checked_out_at, o.paid_at, o.cancelled_at, o.cancel_reason,
  o.created_at, o.updated_at,
  (o.status IN ${OPEN} AND o.expires_at <= now()) AS hold_expired,
  CASE WHEN o.status IN ${OPEN} THEN greatest(0, ceil(extract(epoch FROM o.expires_at - now())))::int END
    AS remaining_seconds`;

// What a customer needs to recognise the order in a list (read model join).
const WITH_EVENT = `${ORDER_COLUMNS}, es.event_id, es.start_at, e.title AS event_title, e.slug AS event_slug,
  v.name AS venue_name`;
const EVENT_JOINS = `JOIN event_schedules es ON es.id = o.schedule_id
  JOIN events e ON e.id = es.event_id
  JOIN venues v ON v.id = es.venue_id`;

/** A new HELD order with zero totals; lines are added, then totals recomputed in SQL. */
async function insertHeldOrder(db, { orderCode, userId, scheduleId, ttlSeconds }) {
  const { rows } = await db.query(
    `INSERT INTO orders (order_code, user_id, schedule_id, status, expires_at)
     VALUES ($1, $2, $3, 'HELD', now() + make_interval(secs => $4))
     RETURNING id, expires_at`,
    [orderCode, userId, scheduleId, ttlSeconds],
  );
  return rows[0];
}

/**
 * Insert order lines in one statement. total_amount is computed by the
 * database (and re-checked by chk_order_items_total).
 * @param {Array<{ scheduleSeatId?: string, seatId?: string, seatLabel?: string, ticketTypeId: string,
 *   ticketTypeName: string, unitPrice: number, quantity: number }>} lines
 */
async function insertItems(db, { orderId, eventId, scheduleId }, lines) {
  await db.query(
    `INSERT INTO order_items (order_id, event_id, schedule_id, schedule_seat_id, seat_id, seat_label,
                              ticket_type_id, ticket_type_name, unit_price, quantity, total_amount)
     SELECT $1, $2, $3, l.schedule_seat_id, l.seat_id, l.seat_label,
            l.ticket_type_id, l.ticket_type_name, l.unit_price, l.quantity, l.unit_price * l.quantity
     FROM unnest($4::uuid[], $5::uuid[], $6::text[], $7::uuid[], $8::text[], $9::bigint[], $10::int[])
       AS l (schedule_seat_id, seat_id, seat_label, ticket_type_id, ticket_type_name, unit_price, quantity)`,
    [
      orderId,
      eventId,
      scheduleId,
      lines.map((l) => l.scheduleSeatId ?? null),
      lines.map((l) => l.seatId ?? null),
      lines.map((l) => l.seatLabel ?? null),
      lines.map((l) => l.ticketTypeId),
      lines.map((l) => l.ticketTypeName),
      lines.map((l) => l.unitPrice),
      lines.map((l) => l.quantity),
    ],
  );
}

/** subtotal = sum of the lines, computed by the database; chk_orders_total checks the rest. */
async function recalculateTotals(db, orderId) {
  await db.query(
    `UPDATE orders o SET subtotal = t.sum, total_amount = t.sum - o.discount_amount
     FROM (SELECT coalesce(sum(total_amount), 0) AS sum FROM order_items WHERE order_id = $1) t
     WHERE o.id = $1`,
    [orderId],
  );
}

async function findById(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

async function findDetail(db, id) {
  const { rows } = await db.query(`SELECT ${WITH_EVENT} FROM orders o ${EVENT_JOINS} WHERE o.id = $1`, [id]);
  return rows[0] ?? null;
}

async function findActiveForUser(db, { userId, scheduleId }) {
  const { rows } = await db.query(
    `SELECT id FROM orders
     WHERE user_id = $1 AND schedule_id = $2 AND status IN ('HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED')`,
    [userId, scheduleId],
  );
  return rows[0] ?? null;
}

async function listItems(db, orderIds) {
  const { rows } = await db.query(
    `SELECT oi.id, oi.order_id, oi.ticket_type_id, oi.ticket_type_name, oi.seat_id, oi.seat_label,
            oi.unit_price, oi.quantity, oi.total_amount
     FROM order_items oi
     WHERE oi.order_id = ANY($1::uuid[])
     ORDER BY oi.order_id, oi.seat_label NULLS LAST, oi.ticket_type_name`,
    [orderIds],
  );
  return rows;
}

async function list(db, { userId, scheduleId, status, limit, offset }) {
  const conditions = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };
  if (userId) add('o.user_id = ?', userId);
  if (scheduleId) add('o.schedule_id = ?', scheduleId);
  if (status) add('o.status = ?::order_status', status);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT ${WITH_EVENT}, count(*) OVER () AS total_count
     FROM orders o ${EVENT_JOINS}
     ${where}
     ORDER BY o.created_at DESC, o.id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

/**
 * Compare-and-set status change. Returns null when the order was no longer in
 * one of the `from` statuses (another request ended it first), so inventory
 * is released at most once.
 * @param {{ orderId: string, from: string[], to: string, cancelReason?: string|null }} change
 */
async function transition(db, { orderId, from, to, cancelReason = null }) {
  const { rows } = await db.query(
    `UPDATE orders
     SET status = $3::order_status,
         cancelled_at = CASE WHEN $3::order_status = 'CANCELLED' THEN now() END,
         cancel_reason = $4,
         paid_at = CASE WHEN $3::order_status = 'PAID' THEN now() ELSE paid_at END
     WHERE id = $1 AND status = ANY($2::order_status[])
     RETURNING id, order_code, user_id, schedule_id, total_amount`,
    [orderId, from, to, cancelReason],
  );
  return rows[0] ?? null;
}

/**
 * HELD → PAYMENT_PENDING, once: price fixed (discount applied), hold extended
 * by the payment window. now() is the transaction's start time, the same
 * value used for the seats' new hold_expires_at.
 */
async function checkout(db, { orderId, discount, windowSeconds }) {
  const { rows } = await db.query(
    `UPDATE orders
     SET status = 'PAYMENT_PENDING', checked_out_at = now(),
         expires_at = now() + make_interval(secs => $3),
         discount_amount = $2, total_amount = subtotal - $2
     WHERE id = $1 AND status = 'HELD'
     RETURNING id, expires_at, total_amount`,
    [orderId, discount, windowSeconds],
  );
  return rows[0] ?? null;
}

/** Payments of an order, newest first (read model for the order page). */
async function listPayments(db, orderId) {
  const { rows } = await db.query(
    `SELECT id, status, amount, currency, provider, failure_code, paid_at, created_at
     FROM payments WHERE order_id = $1 ORDER BY created_at DESC`,
    [orderId],
  );
  return rows;
}

/** After the show: PAID orders of finished schedules are COMPLETED (no regular refund any more). */
async function completeOrdersOfFinishedSchedules(db) {
  const { rowCount } = await db.query(
    `UPDATE orders o SET status = 'COMPLETED'
     FROM event_schedules es
     WHERE es.id = o.schedule_id AND es.status = 'FINISHED' AND o.status = 'PAID'`,
  );
  return rowCount;
}

/** Tickets of an order with what is printed on them (read model for the order page). */
async function listTickets(db, orderId) {
  const { rows } = await db.query(
    `SELECT t.id, t.ticket_code, t.admission_no, t.status, t.issued_at, t.used_at, oi.seat_label, oi.ticket_type_name
     FROM tickets t JOIN order_items oi ON oi.id = t.order_item_id
     WHERE t.order_id = $1
     ORDER BY oi.seat_label NULLS LAST, oi.ticket_type_name, t.admission_no`,
    [orderId],
  );
  return rows;
}

/**
 * Before a refund: lock the order's tickets (a gate scanning one of them
 * waits, then sees it REFUNDED) and tell whether any has been checked in.
 */
async function lockTicketsHasUsed(db, orderId) {
  const { rows } = await db.query(`SELECT status FROM tickets WHERE order_id = $1 ORDER BY id FOR UPDATE`, [orderId]);
  return rows.some((row) => row.status === 'USED');
}

/** Refund: tickets issued for the order (Phase 9) stop being valid. */
async function refundTicketsOfOrder(db, orderId) {
  await db.query(
    `UPDATE tickets SET status = 'REFUNDED', cancelled_at = now() WHERE order_id = $1 AND status = 'VALID'`,
    [orderId],
  );
}

/** GA lines in ticket_type_id order: the lock order of ga_inventory rows. */
async function gaLines(db, orderId) {
  const { rows } = await db.query(
    `SELECT ticket_type_id, quantity FROM order_items
     WHERE order_id = $1 AND schedule_seat_id IS NULL
     ORDER BY ticket_type_id`,
    [orderId],
  );
  return rows.map((row) => ({ ticketTypeId: row.ticket_type_id, quantity: row.quantity }));
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

/** Candidates only (no lock): each one is re-checked and locked in its own transaction. */
async function findDueOrderIds(db, { scheduleId = null, userId = null, limit }) {
  const { rows } = await db.query(
    `SELECT id FROM orders
     WHERE status IN ${OPEN} AND expires_at <= now()
       AND ($1::uuid IS NULL OR schedule_id = $1)
       AND ($2::uuid IS NULL OR user_id = $2)
     ORDER BY expires_at
     LIMIT $3`,
    [scheduleId, userId, limit],
  );
  return rows.map((row) => row.id);
}

/**
 * Lock one due order. SKIP LOCKED: if another sweeper (or a cancel) has it,
 * skip it instead of waiting; that request will finish the job.
 */
async function lockDueOrder(db, id) {
  const { rows } = await db.query(
    `SELECT id FROM orders WHERE id = $1 AND status IN ${OPEN} AND expires_at <= now() FOR UPDATE SKIP LOCKED`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Orders of an event or of one schedule in the given statuses, locked in id
 * order (cancellations: open orders are cancelled, paid ones refunded).
 */
async function lockOrdersOf(db, { eventId = null, scheduleId = null }, statuses) {
  const { rows } = await db.query(
    `SELECT o.id FROM orders o
     JOIN event_schedules es ON es.id = o.schedule_id
     WHERE o.status = ANY($3::order_status[])
       AND ($1::uuid IS NULL OR es.event_id = $1)
       AND ($2::uuid IS NULL OR o.schedule_id = $2)
     ORDER BY o.id
     FOR UPDATE OF o`,
    [eventId, scheduleId, statuses],
  );
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------
// Reconciliation: recount inventory from orders. One statement = one snapshot,
// so concurrent bookings can never make a correct database look wrong.
// ---------------------------------------------------------------------------

async function findInventoryMismatches(db) {
  const { rows } = await db.query(
    `WITH ga_expected AS (
       SELECT oi.ticket_type_id,
              sum(oi.quantity) FILTER (WHERE o.status IN ('HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED')) AS held,
              sum(oi.quantity) FILTER (WHERE o.status IN ('PAID', 'COMPLETED')) AS sold
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.schedule_seat_id IS NULL
       GROUP BY oi.ticket_type_id
     )
     SELECT 'GA_COUNTER' AS kind, g.ticket_type_id AS id,
            format('held %s (orders say %s), sold %s (orders say %s)',
                   g.held_quantity, coalesce(x.held, 0), g.sold_quantity, coalesce(x.sold, 0)) AS problem
     FROM ga_inventory g
     LEFT JOIN ga_expected x ON x.ticket_type_id = g.ticket_type_id
     WHERE g.held_quantity <> coalesce(x.held, 0) OR g.sold_quantity <> coalesce(x.sold, 0)

     UNION ALL
     -- A HELD seat must belong to an open order that has a line for it.
     SELECT 'SEAT_HELD_WITHOUT_ORDER', s.id, format('held by order %s', s.held_by_order_id)
     FROM schedule_seats s
     LEFT JOIN orders o ON o.id = s.held_by_order_id
     WHERE s.status = 'HELD'
       AND (o.status IS NULL OR o.status NOT IN ('HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED')
            OR NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.schedule_seat_id = s.id))

     UNION ALL
     -- A seat line of an open order must be HELD by that order.
     SELECT 'ORDER_SEAT_NOT_HELD', oi.id, format('order %s, seat %s', oi.order_id, oi.schedule_seat_id)
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN schedule_seats s ON s.id = oi.schedule_seat_id
     WHERE o.status IN ('HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED')
       AND (s.status <> 'HELD' OR s.held_by_order_id IS DISTINCT FROM o.id)

     UNION ALL
     -- A SOLD seat must belong to a paid order that has a line for it.
     SELECT 'SEAT_SOLD_WITHOUT_ORDER', s.id, format('sold to order %s', s.sold_by_order_id)
     FROM schedule_seats s
     LEFT JOIN orders o ON o.id = s.sold_by_order_id
     WHERE s.status = 'SOLD'
       AND (o.status IS NULL OR o.status NOT IN ('PAID', 'COMPLETED')
            OR NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.schedule_seat_id = s.id))

     UNION ALL
     -- A seat line of a paid order must be SOLD to that order.
     SELECT 'ORDER_SEAT_NOT_SOLD', oi.id, format('order %s, seat %s', oi.order_id, oi.schedule_seat_id)
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN schedule_seats s ON s.id = oi.schedule_seat_id
     WHERE o.status IN ('PAID', 'COMPLETED')
       AND (s.status <> 'SOLD' OR s.sold_by_order_id IS DISTINCT FROM o.id)

     UNION ALL
     -- used_count of a promotion = its usage rows (taken at checkout, returned when an unpaid order ends).
     SELECT 'PROMOTION_USED_COUNT', p.id, format('used_count %s, usages %s', p.used_count, count(u.id))
     FROM promotions p
     LEFT JOIN promotion_usages u ON u.promotion_id = p.id
     GROUP BY p.id
     HAVING p.used_count <> count(u.id)`,
  );
  return rows;
}

module.exports = {
  insertHeldOrder,
  insertItems,
  recalculateTotals,
  findById,
  findDetail,
  findActiveForUser,
  listItems,
  list,
  transition,
  gaLines,
  findDueOrderIds,
  lockDueOrder,
  lockOrdersOf,
  checkout,
  listPayments,
  refundTicketsOfOrder,
  lockTicketsHasUsed,
  completeOrdersOfFinishedSchedules,
  listTickets,
  findInventoryMismatches,
};
