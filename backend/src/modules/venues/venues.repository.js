const { buildSetClause } = require('../../utils/sql');
const { escapeLike } = require('../../utils/pagination');

const COLUMNS = `id, name, address_line, city, province, country, latitude, longitude, capacity, status,
  created_by_organizer_id, created_at, updated_at`;

const UPDATABLE = {
  name: 'name',
  addressLine: 'address_line',
  city: 'city',
  province: 'province',
  country: 'country',
  latitude: 'latitude',
  longitude: 'longitude',
  capacity: 'capacity',
  status: 'status',
};

/**
 * Which venues a caller sees:
 *  - managers: every venue (optionally one status), or only ACTIVE ones by default
 *  - an organizer: ACTIVE ones + the PENDING ones they proposed
 *  - anyone else: ACTIVE ones
 * @param {{ q?: string, city?: string, includeAll: boolean, status?: string, organizerId?: string|null,
 *           limit: number, offset: number }} filters
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function list(db, { q, city, includeAll, status, organizerId, limit, offset }) {
  const params = [];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [];
  if (status) where.push(`status = ${param(status)}`);
  else if (includeAll) where.push('true');
  else if (organizerId) where.push(`(status = 'ACTIVE' OR (status = 'PENDING' AND created_by_organizer_id = ${param(organizerId)}))`);
  else where.push(`status = 'ACTIVE'`);
  if (q) where.push(`immutable_unaccent(lower(name)) LIKE '%' || immutable_unaccent(lower(${param(escapeLike(q))})) || '%' ESCAPE '\\'`);
  if (city) where.push(`immutable_unaccent(lower(city)) = immutable_unaccent(lower(${param(city)}))`);

  const { rows } = await db.query(
    `SELECT ${COLUMNS}, count(*) OVER () AS total
     FROM venues
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY name, id
     LIMIT ${param(limit)} OFFSET ${param(offset)}`,
    params,
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

async function findById(db, id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM venues WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

async function insert(db, venue) {
  const { rows } = await db.query(
    `INSERT INTO venues (name, address_line, city, province, country, latitude, longitude, capacity,
                         status, created_by_organizer_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${COLUMNS}`,
    [
      venue.name,
      venue.addressLine,
      venue.city,
      venue.province ?? null,
      venue.country,
      venue.latitude ?? null,
      venue.longitude ?? null,
      venue.capacity ?? null,
      venue.status,
      venue.createdByOrganizerId ?? null,
    ],
  );
  return rows[0];
}

async function update(db, id, changes) {
  const { clause, params } = buildSetClause(changes, UPDATABLE, 2);
  const { rows } = await db.query(`UPDATE venues SET ${clause} WHERE id = $1 RETURNING ${COLUMNS}`, [id, ...params]);
  return rows[0] ?? null;
}

/** Venues used by the live schedules of an event, locked (approval of the event). */
async function lockVenuesOfEvent(db, eventId) {
  const { rows } = await db.query(
    `SELECT v.id, v.status FROM venues v
     WHERE v.id IN (SELECT venue_id FROM event_schedules WHERE event_id = $1 AND status = 'SCHEDULED')
     ORDER BY v.id
     FOR UPDATE`,
    [eventId],
  );
  return rows;
}

async function activate(db, ids) {
  await db.query(`UPDATE venues SET status = 'ACTIVE' WHERE id = ANY($1::uuid[]) AND status = 'PENDING'`, [ids]);
}

module.exports = { list, findById, insert, update, lockVenuesOfEvent, activate };
