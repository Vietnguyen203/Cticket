const { buildSetClause } = require('../../utils/sql');

const COLUMNS = 'id, name, slug, description, created_at, updated_at';
const UPDATABLE = { name: 'name', slug: 'slug', description: 'description' };

async function listAll(db) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM categories ORDER BY name`);
  return rows;
}

async function findById(db, id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM categories WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

async function insert(db, { name, slug, description = null }) {
  const { rows } = await db.query(
    `INSERT INTO categories (name, slug, description) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
    [name, slug, description],
  );
  return rows[0];
}

async function update(db, id, changes) {
  const { clause, params } = buildSetClause(changes, UPDATABLE, 2);
  const { rows } = await db.query(`UPDATE categories SET ${clause} WHERE id = $1 RETURNING ${COLUMNS}`, [id, ...params]);
  return rows[0] ?? null;
}

/** @returns {Promise<boolean>} whether a row was deleted */
async function remove(db, id) {
  const { rowCount } = await db.query(`DELETE FROM categories WHERE id = $1`, [id]);
  return rowCount > 0;
}

module.exports = { listAll, findById, insert, update, remove };
