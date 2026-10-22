const { buildSetClause } = require('../../utils/sql');

const COLUMNS = `id, schedule_id, venue_zone_id, code, name, description, price, currency, inventory_mode,
  capacity, max_per_order, sort_order, status, created_at, updated_at`;

const UPDATABLE = {
  code: 'code',
  name: 'name',
  description: 'description',
  price: 'price',
  capacity: 'capacity',
  venueZoneId: 'venue_zone_id',
  maxPerOrder: 'max_per_order',
  sortOrder: 'sort_order',
  status: 'status',
};

async function listBySchedule(db, scheduleId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM ticket_types WHERE schedule_id = $1 ORDER BY sort_order, price DESC, code`,
    [scheduleId],
  );
  return rows;
}

async function findById(db, id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM ticket_types WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

async function insert(db, ticketType) {
  const { rows } = await db.query(
    `INSERT INTO ticket_types
       (schedule_id, venue_zone_id, code, name, description, price, currency, inventory_mode,
        capacity, max_per_order, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${COLUMNS}`,
    [
      ticketType.scheduleId,
      ticketType.venueZoneId ?? null,
      ticketType.code,
      ticketType.name,
      ticketType.description ?? null,
      ticketType.price,
      ticketType.currency,
      ticketType.inventoryMode,
      ticketType.capacity ?? null,
      ticketType.maxPerOrder,
      ticketType.sortOrder,
    ],
  );
  return rows[0];
}

async function update(db, id, changes) {
  const { clause, params } = buildSetClause(changes, UPDATABLE, 2);
  const { rows } = await db.query(`UPDATE ticket_types SET ${clause} WHERE id = $1 RETURNING ${COLUMNS}`, [
    id,
    ...params,
  ]);
  return rows[0];
}

/** Deleting a ticket type also removes its seat plan rows (FK ON DELETE CASCADE). */
async function remove(db, id) {
  await db.query(`DELETE FROM ticket_types WHERE id = $1`, [id]);
}

async function countBySchedule(db, scheduleId) {
  const { rows } = await db.query(`SELECT count(*) AS count FROM ticket_types WHERE schedule_id = $1`, [scheduleId]);
  return rows[0].count;
}

/** Total GA capacity already sold through a standing zone in this schedule. */
async function sumGaCapacityForZone(db, { scheduleId, zoneId, excludeTicketTypeId = null }) {
  const { rows } = await db.query(
    `SELECT coalesce(sum(capacity), 0) AS total
     FROM ticket_types
     WHERE schedule_id = $1 AND venue_zone_id = $2 AND inventory_mode = 'GENERAL_ADMISSION'
       AND ($3::uuid IS NULL OR id <> $3)`,
    [scheduleId, zoneId, excludeTicketTypeId],
  );
  return rows[0].total;
}

/**
 * Places a show already sells: the capacity of its standing ticket types and
 * the seats of its seat plan (optionally leaving one ticket type / the plan out).
 */
async function allocatedPlaces(db, scheduleId, { excludeTicketTypeId = null, withoutPlan = false } = {}) {
  const { rows } = await db.query(
    `SELECT
       (SELECT coalesce(sum(capacity), 0) FROM ticket_types
        WHERE schedule_id = $1 AND inventory_mode = 'GENERAL_ADMISSION' AND status = 'ACTIVE'
          AND ($2::uuid IS NULL OR id <> $2))::int AS standing,
       (SELECT count(*) FROM schedule_seat_plan WHERE schedule_id = $1 AND NOT $3)::int AS seats`,
    [scheduleId, excludeTicketTypeId, withoutPlan],
  );
  return rows[0].standing + rows[0].seats;
}

module.exports = { listBySchedule, findById, insert, update, remove, countBySchedule, sumGaCapacityForZone, allocatedPlaces };
