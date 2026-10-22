const { buildSetClause } = require('../../utils/sql');

const SCHEDULE_COLUMNS = `es.id, es.event_id, es.venue_id, es.start_at, es.end_at, es.sales_start_at, es.sales_end_at,
  es.status, es.capacity, es.inventory_generated_at, es.created_at, es.updated_at`;

// Venue summary for display (read model join).
const WITH_VENUE = `${SCHEDULE_COLUMNS}, v.name AS venue_name, v.city AS venue_city, v.address_line AS venue_address`;

const UPDATABLE = {
  venueId: 'venue_id',
  startAt: 'start_at',
  endAt: 'end_at',
  salesStartAt: 'sales_start_at',
  salesEndAt: 'sales_end_at',
  capacity: 'capacity', // total attendance planned
  status: 'status',
};

async function listByEvent(db, eventId) {
  const { rows } = await db.query(
    `SELECT ${WITH_VENUE}
     FROM event_schedules es
     JOIN venues v ON v.id = es.venue_id
     WHERE es.event_id = $1
     ORDER BY es.start_at, es.id`,
    [eventId],
  );
  return rows;
}

async function findById(db, id, { forUpdate = false, forShare = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${SCHEDULE_COLUMNS} FROM event_schedules es WHERE es.id = $1 ${forUpdate ? 'FOR UPDATE' : forShare ? 'FOR SHARE' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

async function findWithVenue(db, id) {
  const { rows } = await db.query(
    `SELECT ${WITH_VENUE} FROM event_schedules es JOIN venues v ON v.id = es.venue_id WHERE es.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** An overlapping schedule at the same venue fails the exclusion constraint → 409 SCHEDULE_CONFLICT. */
async function insert(db, { eventId, venueId, startAt, endAt, salesStartAt, salesEndAt, capacity = null }) {
  const { rows } = await db.query(
    `INSERT INTO event_schedules (event_id, venue_id, start_at, end_at, sales_start_at, sales_end_at, capacity)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [eventId, venueId, startAt, endAt, salesStartAt, salesEndAt, capacity],
  );
  return rows[0].id;
}

async function update(db, id, changes) {
  const { clause, params } = buildSetClause(changes, UPDATABLE, 2);
  await db.query(`UPDATE event_schedules SET ${clause} WHERE id = $1`, [id, ...params]);
}

async function remove(db, id) {
  await db.query(`DELETE FROM event_schedules WHERE id = $1`, [id]);
}

async function removeByEvent(db, eventId) {
  await db.query(`DELETE FROM event_schedules WHERE event_id = $1`, [eventId]);
}

/** Cancelling an event cancels its schedules, which also frees the venue time slots. */
async function cancelByEvent(db, eventId) {
  await db.query(
    `UPDATE event_schedules SET status = 'CANCELLED' WHERE event_id = $1 AND status = 'SCHEDULED'`,
    [eventId],
  );
}

async function countUpcoming(db, eventId) {
  const { rows } = await db.query(
    `SELECT count(*) AS count FROM event_schedules
     WHERE event_id = $1 AND status = 'SCHEDULED' AND start_at > now()`,
    [eventId],
  );
  return rows[0].count;
}

/** How many active (not cancelled) shows the event has. */
async function countActive(db, eventId) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM event_schedules WHERE event_id = $1 AND status <> 'CANCELLED'`, [eventId]);
  return rows[0].n;
}

/** An active schedule at the venue overlapping [startAt, endAt) (the rule of the exclusion constraint). */
async function findOverlap(db, { venueId, startAt, endAt, excludeScheduleId = null }) {
  const { rows } = await db.query(
    `SELECT id, event_id, start_at, end_at FROM event_schedules
     WHERE venue_id = $1 AND status <> 'CANCELLED'
       AND tstzrange(start_at, end_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
       AND ($4::uuid IS NULL OR id <> $4)
     ORDER BY start_at LIMIT 1`,
    [venueId, startAt, endAt, excludeScheduleId],
  );
  return rows[0] ?? null;
}

module.exports = {
  countActive,
  findOverlap,
  listByEvent,
  findById,
  findWithVenue,
  insert,
  update,
  remove,
  removeByEvent,
  cancelByEvent,
  countUpcoming,
};
