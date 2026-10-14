/**
 * Deleting an event for good, sales included (decided with the product owner:
 * the admin, or the event's organizer, may delete any event). Everything its
 * schedules sold goes: check-ins, tickets, refunds, payments, promotion uses
 * (given back to their codes), reviews, order lines, orders, and the
 * schedules' seat / standing inventory. Children first, so no foreign key
 * ever points at a deleted row.
 *
 * The caller holds the EVENT row lock (FOR UPDATE): new bookings of its
 * schedules wait for it (they lock the event FOR SHARE) and then find no
 * event. The schedule rows are NOT locked first: an in-flight check-in holds
 * its ticket lock and needs the schedule row; waiting for that ticket while
 * holding the schedule would deadlock.
 */
const SCHEDULES = `SELECT id FROM event_schedules WHERE event_id = $1`;
const ORDERS = `SELECT id FROM orders WHERE schedule_id IN (${SCHEDULES})`;
const SOLD = `('PAID', 'COMPLETED')`;

/** What deleting the event would remove (shown before the admin / organizer confirms). */
async function summarizeEventSales(db, eventId) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM event_schedules WHERE event_id = $1) AS schedules,
            (SELECT count(*)::int FROM orders WHERE schedule_id IN (${SCHEDULES})) AS orders,
            (SELECT count(*)::int FROM orders WHERE schedule_id IN (${SCHEDULES}) AND status IN ${SOLD}) AS paid_orders,
            (SELECT coalesce(sum(total_amount), 0)::bigint FROM orders WHERE schedule_id IN (${SCHEDULES}) AND status IN ${SOLD}) AS revenue,
            (SELECT count(*)::int FROM tickets WHERE schedule_id IN (${SCHEDULES})) AS tickets,
            (SELECT count(*)::int FROM check_ins WHERE schedule_id IN (${SCHEDULES})) AS check_ins`,
    [eventId],
  );
  const row = rows[0];
  return {
    schedules: row.schedules,
    orders: row.orders,
    paidOrders: row.paid_orders,
    revenue: row.revenue,
    tickets: row.tickets,
    checkIns: row.check_ins,
  };
}

/** Delete everything the event's schedules sold, and their inventory. */
async function purgeEventSales(db, eventId) {
  const run = (sql) => db.query(sql, [eventId]);
  await run(`DELETE FROM check_ins WHERE schedule_id IN (${SCHEDULES})`);
  await run(`DELETE FROM tickets WHERE schedule_id IN (${SCHEDULES})`);
  await run(`DELETE FROM refunds WHERE order_id IN (${ORDERS})`);
  await run(`DELETE FROM payments WHERE order_id IN (${ORDERS})`);
  // A deleted order's use of a code is given back, as when an order is cancelled.
  await run(
    `WITH removed AS (DELETE FROM promotion_usages WHERE order_id IN (${ORDERS}) RETURNING promotion_id)
     UPDATE promotions p SET used_count = greatest(0, p.used_count - r.n)
     FROM (SELECT promotion_id, count(*)::int AS n FROM removed GROUP BY promotion_id) r
     WHERE p.id = r.promotion_id`,
  );
  await run(`DELETE FROM reviews WHERE event_id = $1 OR order_id IN (${ORDERS})`);
  await run(`DELETE FROM order_items WHERE schedule_id IN (${SCHEDULES})`);
  // Seats point at the orders that hold / bought them: they go before the orders.
  await run(`DELETE FROM schedule_seats WHERE schedule_id IN (${SCHEDULES})`);
  await run(`DELETE FROM ga_inventory WHERE schedule_id IN (${SCHEDULES})`);
  await run(`DELETE FROM orders WHERE schedule_id IN (${SCHEDULES})`);
}

module.exports = { summarizeEventSales, purgeEventSales };
