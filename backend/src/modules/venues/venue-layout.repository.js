const { buildSetClause } = require('../../utils/sql');

const ZONE_COLUMNS = 'id, venue_id, name, code, kind, capacity, created_at, updated_at';
const SEAT_COLUMNS = 's.id, s.venue_zone_id, s.row_label, s.seat_number, s.seat_code, s.seat_type, s.x, s.y';

async function insertZone(db, { venueId, code, name, kind, capacity = null }) {
  const { rows } = await db.query(
    `INSERT INTO venue_zones (venue_id, code, name, kind, capacity)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${ZONE_COLUMNS}`,
    [venueId, code, name, kind, capacity],
  );
  return rows[0];
}

async function findZoneById(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${ZONE_COLUMNS} FROM venue_zones WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

async function updateZone(db, id, changes) {
  const { clause, params } = buildSetClause(changes, { name: 'name', capacity: 'capacity' }, 2);
  const { rows } = await db.query(`UPDATE venue_zones SET ${clause} WHERE id = $1 RETURNING ${ZONE_COLUMNS}`, [
    id,
    ...params,
  ]);
  return rows[0] ?? null;
}

/**
 * Insert many seats in ONE statement: the arrays are expanded with unnest().
 * Either every seat is created or none (a duplicate seat code fails the whole
 * statement through the UNIQUE constraint).
 */
async function insertSeats(db, zoneId, seats) {
  const { rowCount } = await db.query(
    `INSERT INTO seats (venue_zone_id, row_label, seat_number, seat_code, seat_type, x, y)
     SELECT $1, row_label, seat_number, seat_code, seat_type, x, y
     FROM unnest($2::text[], $3::int[], $4::text[], $5::seat_type[], $6::numeric[], $7::numeric[])
       AS t (row_label, seat_number, seat_code, seat_type, x, y)`,
    [
      zoneId,
      seats.map((s) => s.rowLabel),
      seats.map((s) => s.seatNumber),
      seats.map((s) => s.seatCode),
      seats.map((s) => s.seatType),
      seats.map((s) => s.x),
      seats.map((s) => s.y),
    ],
  );
  return rowCount;
}

/** @returns {Promise<boolean>} whether a row was deleted */
async function deleteSeat(db, id) {
  const { rowCount } = await db.query(`DELETE FROM seats WHERE id = $1`, [id]);
  return rowCount > 0;
}

async function listZones(db, venueId) {
  const { rows } = await db.query(`SELECT ${ZONE_COLUMNS} FROM venue_zones WHERE venue_id = $1 ORDER BY code`, [
    venueId,
  ]);
  return rows;
}

async function listSeats(db, venueId) {
  const { rows } = await db.query(
    `SELECT ${SEAT_COLUMNS}
     FROM seats s
     JOIN venue_zones z ON z.id = s.venue_zone_id
     WHERE z.venue_id = $1
     ORDER BY z.code, s.row_label, s.seat_number, s.seat_code`,
    [venueId],
  );
  return rows;
}

/**
 * Seats of a venue that can be sold as reserved seats, selected by explicit
 * ids, by zone, or by zone + rows. Only SEATED zones of THIS venue qualify, so
 * a seat plan can never point at another venue's seats.
 */
async function findPlannableSeats(db, { venueId, seatIds, zoneId, rows }) {
  const params = [venueId];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [`z.venue_id = $1`, `z.kind = 'SEATED'`];
  if (seatIds) where.push(`s.id = ANY(${param(seatIds)}::uuid[])`);
  if (zoneId) where.push(`z.id = ${param(zoneId)}`);
  if (rows) where.push(`s.row_label = ANY(${param(rows)}::text[])`);

  const result = await db.query(
    `SELECT s.id FROM seats s JOIN venue_zones z ON z.id = s.venue_zone_id WHERE ${where.join(' AND ')}`,
    params,
  );
  return result.rows.map((row) => row.id);
}

module.exports = {
  insertZone,
  findZoneById,
  updateZone,
  insertSeats,
  deleteSeat,
  listZones,
  listSeats,
  findPlannableSeats,
};
