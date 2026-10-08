const { buildSetClause } = require('../../utils/sql');
const { escapeLike } = require('../../utils/pagination');

const COLUMNS = `id, name, address_line, city, province, country, latitude, longitude, capacity, status,
  created_at, updated_at`;

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
 * @param {{ q?: string, city?: string, includeInactive: boolean, limit: number, offset: number }} filters
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function list(db, { q, city, includeInactive, limit, offset }) {
  const params = [];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [];
  if (!includeInactive) where.push(`status = 'ACTIVE'`);
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
    `INSERT INTO venues (name, address_line, city, province, country, latitude, longitude, capacity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
    ],
  );
  return rows[0];
}

async function update(db, id, changes) {
  const { clause, params } = buildSetClause(changes, UPDATABLE, 2);
  const { rows } = await db.query(`UPDATE venues SET ${clause} WHERE id = $1 RETURNING ${COLUMNS}`, [id, ...params]);
  return rows[0] ?? null;
}

module.exports = { list, findById, insert, update };
