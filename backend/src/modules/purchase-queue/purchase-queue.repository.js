/**
 * Phase 21: what the purchase queue reads from PostgreSQL. The queue itself
 * lives in Redis; the settings live on the event row (events module).
 * Read model: these queries read tables of the events, orders and waitlist
 * modules, as the reports do.
 */

const SETTINGS = `e.id AS event_id, e.organizer_id, e.status, e.queue_enabled, e.queue_capacity, e.queue_session_minutes`;

async function settingsOfEvent(db, eventId) {
  const { rows } = await db.query(`SELECT ${SETTINGS} FROM events e WHERE e.id = $1`, [eventId]);
  return rows[0] ?? null;
}

async function settingsOfSchedule(db, scheduleId) {
  const { rows } = await db.query(
    `SELECT ${SETTINGS} FROM event_schedules s JOIN events e ON e.id = s.event_id WHERE s.id = $1`,
    [scheduleId],
  );
  return rows[0] ?? null;
}

/** Published events with the queue on (the admission job). */
async function queuedEvents(db) {
  const { rows } = await db.query(
    `SELECT ${SETTINGS} FROM events e WHERE e.queue_enabled AND e.status = 'PUBLISHED'`,
  );
  return rows;
}

/** Does the person still have an unpaid order (held, at payment) for this event? Then their turn goes on. */
async function hasOpenOrderInEvent(db, { userId, eventId }) {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM orders o JOIN event_schedules s ON s.id = o.schedule_id
       WHERE o.user_id = $1 AND s.event_id = $2
         AND o.status IN ('HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED')
     ) AS open`,
    [userId, eventId],
  );
  return rows[0].open;
}

/** Phase 18.4: places kept for this person from the waiting list of the schedule; they book without a turn. */
async function hasWaitlistOffer(db, { userId, scheduleId }) {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM waitlist_entries
       WHERE user_id = $1 AND schedule_id = $2 AND status = 'OFFERED' AND offer_expires_at > now()
     ) AS offered`,
    [userId, scheduleId],
  );
  return rows[0].offered;
}

module.exports = { settingsOfEvent, settingsOfSchedule, queuedEvents, hasOpenOrderInEvent, hasWaitlistOffer };
