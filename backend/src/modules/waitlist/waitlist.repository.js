/**
 * Phase 18.4: SQL of the waiting list. Reads the inventory tables directly
 * (no require of the events / orders modules: they call this one).
 */

const LIVE = `('WAITING', 'OFFERED')`;
// An offer still running: its places are kept for that person.
const RUNNING_OFFER = `status = 'OFFERED' AND offer_expires_at > now()`;

/**
 * Places that can be sold now, per ticket type: the same count as the
 * availability endpoint (a HELD seat whose hold ran out counts as free).
 * @returns {Promise<Map<string, number>>}
 */
async function freePlaces(db, ticketTypeIds) {
  if (ticketTypeIds.length === 0) return new Map();
  const { rows } = await db.query(
    `SELECT tt.id,
            CASE WHEN tt.inventory_mode = 'GENERAL_ADMISSION'
                 THEN g.capacity - g.held_quantity - g.sold_quantity - g.blocked_quantity
                 ELSE (SELECT count(*) FROM schedule_seats s
                       WHERE s.schedule_id = tt.schedule_id AND s.ticket_type_id = tt.id
                         AND (s.status = 'AVAILABLE' OR (s.status = 'HELD' AND s.hold_expires_at <= now())))
            END::int AS free
     FROM ticket_types tt
     LEFT JOIN ga_inventory g ON g.ticket_type_id = tt.id
     WHERE tt.id = ANY($1)`,
    [ticketTypeIds],
  );
  return new Map(rows.map((row) => [row.id, row.free]));
}

/** Places kept for running offers of OTHER people, per ticket type. @returns {Promise<Map<string, number>>} */
async function keptForOthers(db, { ticketTypeIds, userId }) {
  if (ticketTypeIds.length === 0) return new Map();
  const { rows } = await db.query(
    `SELECT ticket_type_id, sum(quantity)::int AS kept
     FROM waitlist_entries
     WHERE ticket_type_id = ANY($1) AND ${RUNNING_OFFER} AND user_id IS DISTINCT FROM $2
     GROUP BY ticket_type_id`,
    [ticketTypeIds, userId],
  );
  return new Map(rows.map((row) => [row.ticket_type_id, row.kept]));
}

/** Of these ticket types, the ones with someone waiting or offered (the others need no check at all). */
async function typesWithLiveEntries(db, ticketTypeIds) {
  if (ticketTypeIds.length === 0) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT ticket_type_id FROM waitlist_entries WHERE ticket_type_id = ANY($1) AND status IN ${LIVE}`,
    [ticketTypeIds],
  );
  return rows.map((row) => row.ticket_type_id);
}

/**
 * One booking or offer run at a time per ticket type, for as long as the
 * transaction lasts (taken in id order). Bookings take it only for types with
 * a waiting list, after their seat locks; the offer job takes no row locks of
 * the inventory, so the two never wait on each other in a circle.
 */
async function lockTicketTypes(db, ticketTypeIds) {
  for (const id of [...ticketTypeIds].sort()) {
    await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('waitlist:' || $1::text, 0))`, [id]);
  }
}

/** The person booked: their entries for these ticket types are done. */
async function markBooked(db, { userId, ticketTypeIds }) {
  await db.query(
    `UPDATE waitlist_entries SET status = 'BOOKED'
     WHERE user_id = $1 AND ticket_type_id = ANY($2) AND status IN ${LIVE}`,
    [userId, ticketTypeIds],
  );
}

/** The ticket type of a schedule, with what joining needs. */
async function findTicketTypeForJoin(db, { scheduleId, ticketTypeId }) {
  const { rows } = await db.query(
    `SELECT tt.id, tt.name, tt.status, tt.max_per_order, es.status AS schedule_status, e.status AS event_status,
            es.sales_start_at <= now() AND es.sales_end_at > now() AS selling
     FROM ticket_types tt
     JOIN event_schedules es ON es.id = tt.schedule_id
     JOIN events e ON e.id = es.event_id
     WHERE tt.id = $1 AND tt.schedule_id = $2`,
    [ticketTypeId, scheduleId],
  );
  return rows[0] ?? null;
}

/** @returns {Promise<object|null>} null when the person already has a live entry (unique index) */
async function insertEntry(db, { userId, scheduleId, ticketTypeId, quantity }) {
  const { rows } = await db.query(
    `INSERT INTO waitlist_entries (user_id, schedule_id, ticket_type_id, quantity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, ticket_type_id) WHERE status IN ${LIVE} DO NOTHING
     RETURNING id`,
    [userId, scheduleId, ticketTypeId, quantity],
  );
  return rows[0] ?? null;
}

const VIEW = `w.id, w.user_id, w.status, w.quantity, w.offered_at, w.offer_expires_at, w.created_at, w.schedule_id,
  tt.id AS ticket_type_id, tt.name AS ticket_type_name, es.start_at, e.title AS event_title, e.slug AS event_slug,
  v.name AS venue_name, u.email, u.first_name,
  -- Place in the queue among the people still waiting for this ticket type.
  CASE WHEN w.status = 'WAITING' THEN (
    SELECT count(*)::int FROM waitlist_entries x
    WHERE x.ticket_type_id = w.ticket_type_id AND x.status = 'WAITING' AND x.created_at <= w.created_at
  ) END AS position`;
const VIEW_JOINS = `JOIN ticket_types tt ON tt.id = w.ticket_type_id
  JOIN event_schedules es ON es.id = w.schedule_id
  JOIN events e ON e.id = es.event_id
  JOIN venues v ON v.id = es.venue_id
  JOIN users u ON u.id = w.user_id`;

async function findView(db, id) {
  const { rows } = await db.query(`SELECT ${VIEW} FROM waitlist_entries w ${VIEW_JOINS} WHERE w.id = $1`, [id]);
  return rows[0] ?? null;
}

/** Mine, live ones first, then the most recent. */
async function listForUser(db, userId, limit) {
  const { rows } = await db.query(
    `SELECT ${VIEW} FROM waitlist_entries w ${VIEW_JOINS}
     WHERE w.user_id = $1
     ORDER BY (w.status IN ${LIVE}) DESC, w.created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

/** @returns {Promise<boolean>} false when it was not live (or not theirs) */
async function cancelEntry(db, { id, userId }) {
  const { rowCount } = await db.query(
    `UPDATE waitlist_entries SET status = 'CANCELLED' WHERE id = $1 AND user_id = $2 AND status IN ${LIVE}`,
    [id, userId],
  );
  return rowCount > 0;
}

// --- the offer job ---------------------------------------------------------------

/** Shows that stopped selling (ended sales, cancelled, finished): their lists close. */
async function closeStopped(db) {
  const { rowCount } = await db.query(
    `UPDATE waitlist_entries w SET status = 'CLOSED'
     FROM event_schedules es JOIN events e ON e.id = es.event_id
     WHERE es.id = w.schedule_id AND w.status IN ${LIVE}
       AND (es.status <> 'SCHEDULED' OR e.status <> 'PUBLISHED' OR es.sales_end_at <= now())`,
  );
  return rowCount;
}

async function typesToOffer(db, limit) {
  const { rows } = await db.query(
    `SELECT DISTINCT ticket_type_id FROM waitlist_entries WHERE status IN ${LIVE} LIMIT $1`,
    [limit],
  );
  return rows.map((row) => row.ticket_type_id);
}

async function expireOffers(db, ticketTypeId) {
  await db.query(
    `UPDATE waitlist_entries SET status = 'EXPIRED'
     WHERE ticket_type_id = $1 AND status = 'OFFERED' AND offer_expires_at <= now()`,
    [ticketTypeId],
  );
}

async function waitingOf(db, ticketTypeId) {
  const { rows } = await db.query(
    `SELECT id, quantity FROM waitlist_entries
     WHERE ticket_type_id = $1 AND status = 'WAITING'
     ORDER BY created_at, id
     FOR UPDATE`,
    [ticketTypeId],
  );
  return rows;
}

async function offer(db, ids, minutes) {
  await db.query(
    `UPDATE waitlist_entries SET status = 'OFFERED', offered_at = now(), offer_expires_at = now() + make_interval(mins => $2)
     WHERE id = ANY($1) AND status = 'WAITING'`,
    [ids, minutes],
  );
}

module.exports = {
  freePlaces,
  keptForOthers,
  typesWithLiveEntries,
  lockTicketTypes,
  markBooked,
  findTicketTypeForJoin,
  insertEntry,
  findView,
  listForUser,
  cancelEntry,
  closeStopped,
  typesToOffer,
  expireOffers,
  waitingOf,
  offer,
};
