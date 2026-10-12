const COLUMNS = 'id, user_id, type, title, message, data, read_at, created_at';

async function insert(db, { userId, type, title, message, data }) {
  const { rows } = await db.query(
    `INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [userId, type, title, message, data ?? null],
  );
  return rows[0];
}

/** Newest first, plus the number still unread (one query each, both indexed). */
async function listForUser(db, { userId, unreadOnly, limit, offset }) {
  const [{ rows }, unread] = await Promise.all([
    db.query(
      `SELECT ${COLUMNS}, count(*) OVER () AS total_count FROM notifications
       WHERE user_id = $1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL)
       ORDER BY created_at DESC, id
       LIMIT $3 OFFSET $4`,
      [userId, unreadOnly, limit, offset],
    ),
    db.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [userId]),
  ]);
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0, unread: unread.rows[0].n };
}

/** Only the owner's notification; keeps the first read time. @returns {Promise<object|null>} */
async function markRead(db, { id, userId }) {
  const { rows } = await db.query(
    `UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
    [id, userId],
  );
  return rows[0] ?? null;
}

async function markAllRead(db, userId) {
  const { rowCount } = await db.query(
    `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return rowCount;
}

module.exports = { insert, listForUser, markRead, markAllRead };
