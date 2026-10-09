const { buildSetClause } = require('../../utils/sql');

const SCHEDULE_COLUMNS = `es.id, es.event_id, es.venue_id, es.start_at, es.end_at, es.sales_start_at, es.sales_end_at,
  es.status, es.inventory_generated_at, es.created_at, es.updated_at`;

// Venue summary for display (read model join).
const WITH_VENUE = `${SCHEDULE_COLUMNS}, v.name AS venue_name, v.city AS venue_city, v.address_line AS venue_address`;

const UPDATABLE = {
  venueId: 'venue_id',
  startAt: 'start_at',
  endAt: 'end_at',
  salesStartAt: 'sales_start_at',
  salesEndAt: 'sales_end_at',
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

async function findById(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${SCHEDULE_COLUMNS} FROM event_schedules es WHERE es.id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
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
async function insert(db, { eventId, venueId, startAt, endAt, salesStartAt, salesEndAt }) {
  const { rows } = await db.query(
    `INSERT INTO event_schedules (event_id, venue_id, start_at, end_at, sales_start_at, sales_end_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [eventId, venueId, startAt, endAt, salesStartAt, salesEndAt],
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

module.exports = {
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
