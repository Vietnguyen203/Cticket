const { VN_TIME_ZONE } = require('./vn-date');

/**
 * Sales figures, read straight from the booking tables (Phase 12.4).
 *
 * - A SOLD order is PAID or COMPLETED. A refunded order leaves the revenue of
 *   the day it was paid and shows up as a refund on the day it was refunded.
 *   Every refund started counts (Phase 17: a VNPay refund stays PENDING until
 *   VNPay accepts it, FAILED until an admin sends it again; the order and its
 *   tickets are refunded at once either way).
 * - Tickets sold = the quantities of the sold orders' items (the same number as
 *   the tickets issued, without waiting for the worker to issue them).
 * - Days are Vietnamese calendar days: "$n::date" becomes the instant of that
 *   midnight in Vietnam, so the range filters can use the paid_at index.
 * - sum() of bigint is numeric in PostgreSQL: cast back to bigint so the
 *   driver returns a JS number (pool.js).
 */
const SOLD = `o.status IN ('PAID', 'COMPLETED')`;
const vnDay = (column) => `(${column} AT TIME ZONE '${VN_TIME_ZONE}')::date`;
const vnStartOf = (param) => `(${param}::date)::timestamp AT TIME ZONE '${VN_TIME_ZONE}'`;
const vnEndOf = (param) => `(${param}::date + 1)::timestamp AT TIME ZONE '${VN_TIME_ZONE}'`;
/** Tickets of one order (joined LATERAL as `q`). */
const ORDER_TICKETS = `LEFT JOIN LATERAL (SELECT sum(oi.quantity)::int AS n FROM order_items oi WHERE oi.order_id = o.id) q ON true`;

// --- one event (REP-01) ------------------------------------------------------

async function findEvent(db, eventId) {
  const { rows } = await db.query(`SELECT id, title, status, slug, organizer_id FROM events WHERE id = $1`, [eventId]);
  return rows[0] ?? null;
}

async function schedulesOfEvent(db, eventId) {
  const { rows } = await db.query(
    `SELECT es.id, es.start_at, es.end_at, es.status, v.name AS venue_name
     FROM event_schedules es
     JOIN venues v ON v.id = es.venue_id
     WHERE es.event_id = $1
     ORDER BY es.start_at`,
    [eventId],
  );
  return rows;
}

/** Per ticket type: places, blocked places, sold, revenue (before discounts), check-ins. */
async function ticketTypesOfEvent(db, eventId) {
  const { rows } = await db.query(
    `SELECT tt.id, tt.schedule_id, tt.name, tt.price, tt.inventory_mode,
            CASE WHEN tt.inventory_mode = 'GENERAL_ADMISSION' THEN coalesce(g.capacity, tt.capacity, 0)
                 ELSE coalesce(s.capacity, 0) END AS capacity,
            CASE WHEN tt.inventory_mode = 'GENERAL_ADMISSION' THEN coalesce(g.blocked_quantity, 0)
                 ELSE coalesce(s.blocked, 0) END AS blocked,
            coalesce(sold.quantity, 0) AS sold,
            coalesce(sold.amount, 0) AS revenue,
            coalesce(ci.n, 0) AS checked_in
     FROM ticket_types tt
     JOIN event_schedules es ON es.id = tt.schedule_id
     LEFT JOIN ga_inventory g ON g.ticket_type_id = tt.id AND g.schedule_id = tt.schedule_id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS capacity, count(*) FILTER (WHERE ss.status = 'BLOCKED')::int AS blocked
       FROM schedule_seats ss
       WHERE ss.schedule_id = tt.schedule_id AND ss.ticket_type_id = tt.id
     ) s ON true
     LEFT JOIN LATERAL (
       SELECT sum(oi.quantity)::int AS quantity, sum(oi.total_amount)::bigint AS amount
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.schedule_id = tt.schedule_id AND oi.ticket_type_id = tt.id AND ${SOLD}
     ) sold ON true
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS n
       FROM check_ins c
       JOIN tickets t ON t.id = c.ticket_id
       JOIN order_items oi ON oi.id = t.order_item_id
       WHERE c.schedule_id = tt.schedule_id AND oi.ticket_type_id = tt.id
     ) ci ON true
     WHERE es.event_id = $1
     ORDER BY tt.sort_order, tt.price DESC, tt.name`,
    [eventId],
  );
  return rows;
}

/** Per schedule: sold orders and their money, refunded orders and the amount refunded. */
async function ordersBySchedule(db, eventId) {
  const { rows } = await db.query(
    `SELECT o.schedule_id,
            count(*) FILTER (WHERE ${SOLD})::int AS orders,
            coalesce(sum(o.subtotal) FILTER (WHERE ${SOLD}), 0)::bigint AS gross,
            coalesce(sum(o.discount_amount) FILTER (WHERE ${SOLD}), 0)::bigint AS discount,
            coalesce(sum(o.total_amount) FILTER (WHERE ${SOLD}), 0)::bigint AS revenue,
            count(*) FILTER (WHERE o.status = 'REFUNDED')::int AS refunded_orders,
            coalesce(sum(r.amount), 0)::bigint AS refunded_amount
     FROM orders o
     JOIN event_schedules es ON es.id = o.schedule_id
     LEFT JOIN LATERAL (
       SELECT sum(rf.amount)::bigint AS amount FROM refunds rf WHERE rf.order_id = o.id
     ) r ON true
     WHERE es.event_id = $1
     GROUP BY o.schedule_id`,
    [eventId],
  );
  return rows;
}

/** Codes used by the event's sold orders. */
async function promotionsOfEvent(db, eventId) {
  const { rows } = await db.query(
    `SELECT p.code, p.name, count(*)::int AS orders, sum(pu.discount_amount)::bigint AS discount
     FROM promotion_usages pu
     JOIN promotions p ON p.id = pu.promotion_id
     JOIN orders o ON o.id = pu.order_id
     JOIN event_schedules es ON es.id = o.schedule_id
     WHERE es.event_id = $1 AND ${SOLD}
     GROUP BY p.id
     ORDER BY discount DESC, p.code`,
    [eventId],
  );
  return rows;
}

/** The Vietnamese day of the event's first payment, or null. */
async function firstSaleDay(db, eventId) {
  const { rows } = await db.query(
    `SELECT to_char(${vnDay('min(o.paid_at)')}, 'YYYY-MM-DD') AS day
     FROM orders o
     JOIN event_schedules es ON es.id = o.schedule_id
     WHERE es.event_id = $1 AND o.paid_at IS NOT NULL`,
    [eventId],
  );
  return rows[0].day;
}

// --- by day (REP-01 chart, REP-02, dashboard) ---------------------------------

/**
 * One row per Vietnamese day from `from` to `to` (both included), days without
 * sales too. Only the event's orders when `eventId` is given.
 */
async function daily(db, { from, to, eventId = null }) {
  const { rows } = await db.query(
    `WITH days AS (
       SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') d
     ),
     sold AS (
       SELECT ${vnDay('o.paid_at')} AS day, count(*)::int AS orders,
              sum(o.total_amount)::bigint AS revenue, coalesce(sum(q.n), 0)::int AS tickets
       FROM orders o
       JOIN event_schedules es ON es.id = o.schedule_id
       ${ORDER_TICKETS}
       WHERE ${SOLD} AND o.paid_at >= ${vnStartOf('$1')} AND o.paid_at < ${vnEndOf('$2')}
         AND ($3::uuid IS NULL OR es.event_id = $3)
       GROUP BY 1
     ),
     refunded AS (
       SELECT ${vnDay('r.created_at')} AS day, count(*)::int AS orders, sum(r.amount)::bigint AS amount
       FROM refunds r
       JOIN orders o ON o.id = r.order_id
       JOIN event_schedules es ON es.id = o.schedule_id
       WHERE r.created_at >= ${vnStartOf('$1')} AND r.created_at < ${vnEndOf('$2')}
         AND ($3::uuid IS NULL OR es.event_id = $3)
       GROUP BY 1
     )
     SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
            coalesce(sold.orders, 0) AS orders, coalesce(sold.tickets, 0) AS tickets,
            coalesce(sold.revenue, 0) AS revenue,
            coalesce(refunded.orders, 0) AS refunded_orders, coalesce(refunded.amount, 0) AS refunded_amount
     FROM days
     LEFT JOIN sold ON sold.day = days.day
     LEFT JOIN refunded ON refunded.day = days.day
     ORDER BY days.day`,
    [from, to, eventId],
  );
  return rows;
}

// --- whole platform (REP-02, dashboard) -----------------------------------------

async function rangeTotals(db, { from, to }) {
  const { rows } = await db.query(
    `SELECT
       (SELECT row_to_json(t) FROM (
          SELECT count(*)::int AS orders, coalesce(sum(o.subtotal), 0)::bigint AS gross,
                 coalesce(sum(o.discount_amount), 0)::bigint AS discount, coalesce(sum(o.total_amount), 0)::bigint AS revenue,
                 coalesce(sum(q.n), 0)::int AS tickets, count(DISTINCT o.user_id)::int AS buyers
          FROM orders o
          ${ORDER_TICKETS}
          WHERE ${SOLD} AND o.paid_at >= ${vnStartOf('$1')} AND o.paid_at < ${vnEndOf('$2')}
       ) t) AS sold,
       (SELECT row_to_json(t) FROM (
          SELECT count(*)::int AS orders, coalesce(sum(r.amount), 0)::bigint AS amount
          FROM refunds r
          WHERE r.created_at >= ${vnStartOf('$1')} AND r.created_at < ${vnEndOf('$2')}
       ) t) AS refunded`,
    [from, to],
  );
  return rows[0];
}

async function topEvents(db, { from, to, limit }) {
  const { rows } = await db.query(
    `SELECT e.id, e.title, e.slug, org.organization_name,
            count(*)::int AS orders, coalesce(sum(q.n), 0)::int AS tickets, sum(o.total_amount)::bigint AS revenue
     FROM orders o
     JOIN event_schedules es ON es.id = o.schedule_id
     JOIN events e ON e.id = es.event_id
     JOIN organizers org ON org.id = e.organizer_id
     ${ORDER_TICKETS}
     WHERE ${SOLD} AND o.paid_at >= ${vnStartOf('$1')} AND o.paid_at < ${vnEndOf('$2')}
     GROUP BY e.id, org.organization_name
     ORDER BY revenue DESC, e.title
     LIMIT $3`,
    [from, to, limit],
  );
  return rows;
}

async function byOrganizer(db, { from, to, limit }) {
  const { rows } = await db.query(
    `SELECT org.id, org.organization_name,
            count(*)::int AS orders, coalesce(sum(q.n), 0)::int AS tickets, sum(o.total_amount)::bigint AS revenue
     FROM orders o
     JOIN event_schedules es ON es.id = o.schedule_id
     JOIN events e ON e.id = es.event_id
     JOIN organizers org ON org.id = e.organizer_id
     ${ORDER_TICKETS}
     WHERE ${SOLD} AND o.paid_at >= ${vnStartOf('$1')} AND o.paid_at < ${vnEndOf('$2')}
     GROUP BY org.id
     ORDER BY revenue DESC, org.organization_name
     LIMIT $3`,
    [from, to, limit],
  );
  return rows;
}

async function platformCounts(db) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM events WHERE status = 'PUBLISHED') AS published_events,
            (SELECT count(*)::int FROM users WHERE created_at >= now() - interval '7 days') AS new_users_7d`,
  );
  return rows[0];
}

// --- an organizer's events (REP-01b) -------------------------------------------

async function eventsOfOrganizer(db, organizerId, limit) {
  const { rows } = await db.query(
    `SELECT e.id, e.title, e.slug, e.status,
            (SELECT min(es.start_at) FROM event_schedules es
             WHERE es.event_id = e.id AND es.status = 'SCHEDULED' AND es.end_at > now()) AS next_start_at,
            (SELECT count(*) FROM schedule_seats ss JOIN event_schedules es ON es.id = ss.schedule_id WHERE es.event_id = e.id)
              + (SELECT coalesce(sum(g.capacity), 0) FROM ga_inventory g JOIN event_schedules es ON es.id = g.schedule_id
                 WHERE es.event_id = e.id) AS capacity,
            (SELECT count(*) FROM schedule_seats ss JOIN event_schedules es ON es.id = ss.schedule_id
             WHERE es.event_id = e.id AND ss.status = 'BLOCKED')
              + (SELECT coalesce(sum(g.blocked_quantity), 0) FROM ga_inventory g JOIN event_schedules es ON es.id = g.schedule_id
                 WHERE es.event_id = e.id) AS blocked,
            coalesce(s.orders, 0) AS orders, coalesce(s.tickets, 0) AS sold, coalesce(s.revenue, 0) AS revenue,
            coalesce(r.orders, 0) AS refunded_orders, coalesce(r.amount, 0) AS refunded_amount
     FROM events e
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS orders, coalesce(sum(q.n), 0)::int AS tickets, sum(o.total_amount)::bigint AS revenue
       FROM orders o
       JOIN event_schedules es ON es.id = o.schedule_id
       ${ORDER_TICKETS}
       WHERE es.event_id = e.id AND ${SOLD}
     ) s ON true
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS orders, sum(rf.amount)::bigint AS amount
       FROM refunds rf
       JOIN orders o ON o.id = rf.order_id
       JOIN event_schedules es ON es.id = o.schedule_id
       WHERE es.event_id = e.id
     ) r ON true
     WHERE e.organizer_id = $1
     ORDER BY e.created_at DESC
     LIMIT $2`,
    [organizerId, limit],
  );
  return rows;
}

module.exports = {
  findEvent,
  schedulesOfEvent,
  ticketTypesOfEvent,
  ordersBySchedule,
  promotionsOfEvent,
  firstSaleDay,
  daily,
  rangeTotals,
  topEvents,
  byOrganizer,
  platformCounts,
  eventsOfOrganizer,
};
