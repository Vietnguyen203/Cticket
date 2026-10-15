/**
 * Phase 19: SQL of event reviews. See docs/phase-19-reviews-design.md.
 * The event's rating_count / rating_sum always follow the PUBLISHED reviews:
 * every change locks the event row first and adjusts them in the same
 * transaction.
 */

const COLUMNS = `r.id, r.user_id, r.event_id, r.order_id, r.rating, r.comment, r.status, r.created_at, r.updated_at,
  r.organizer_reply, r.organizer_replied_at, r.hidden_reason, r.moderated_at`;
// "Lan N.": first name and the initial of the last name, never the email.
const AUTHOR = `trim(coalesce(u.first_name, '') || ' ' || coalesce(left(u.last_name, 1) || '.', '')) AS author_name`;

/** The event, locked (lock order: events first). */
async function lockEvent(db, eventId) {
  const { rows } = await db.query(
    `SELECT id, organizer_id, status, rating_count, rating_sum FROM events WHERE id = $1 FOR UPDATE`,
    [eventId],
  );
  return rows[0] ?? null;
}

/** By id or slug, with what the public pages need. */
async function findEvent(db, idOrSlug) {
  const { rows } = await db.query(
    `SELECT id, slug, title, organizer_id, status, rating_count, rating_sum FROM events
     WHERE slug = $1 OR id::text = $1`,
    [idOrSlug],
  );
  return rows[0] ?? null;
}

/**
 * May this person review this event? Their order of it with a ticket used at
 * the gate, the latest show first (its end + EDIT_DAYS is the deadline).
 */
async function attendance(db, { userId, eventId }) {
  const { rows } = await db.query(
    `SELECT o.id AS order_id, es.end_at
     FROM orders o
     JOIN event_schedules es ON es.id = o.schedule_id
     WHERE o.user_id = $1 AND es.event_id = $2
       AND EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = o.id AND t.status = 'USED')
     ORDER BY es.end_at DESC
     LIMIT 1`,
    [userId, eventId],
  );
  return rows[0] ?? null;
}

async function findMine(db, { userId, eventId, forUpdate = false }) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM reviews r WHERE r.user_id = $1 AND r.event_id = $2 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [userId, eventId],
  );
  return rows[0] ?? null;
}

async function findById(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM reviews r WHERE r.id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  return rows[0] ?? null;
}

async function insert(db, { userId, eventId, orderId, rating, comment }) {
  const { rows } = await db.query(
    `INSERT INTO reviews AS r (user_id, event_id, order_id, rating, comment, status)
     VALUES ($1, $2, $3, $4, $5, 'PUBLISHED')
     RETURNING ${COLUMNS}`,
    [userId, eventId, orderId, rating, comment],
  );
  return rows[0];
}

async function update(db, id, { rating, comment }) {
  const { rows } = await db.query(
    `UPDATE reviews r SET rating = $2, comment = $3 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, rating, comment],
  );
  return rows[0];
}

async function remove(db, id) {
  await db.query(`DELETE FROM reviews WHERE id = $1`, [id]);
}

/** +/- on the event's published figures (the event row is locked by the caller). */
async function adjustRating(db, eventId, { count, sum }) {
  await db.query(`UPDATE events SET rating_count = rating_count + $2, rating_sum = rating_sum + $3 WHERE id = $1`, [
    eventId,
    count,
    sum,
  ]);
}

async function setStatus(db, id, { status, reason = null, moderatorId = null }) {
  const { rows } = await db.query(
    `UPDATE reviews r SET status = $2::review_status, hidden_reason = $3, moderated_by = $4, moderated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, status, reason, moderatorId],
  );
  return rows[0];
}

async function setReply(db, id, reply) {
  const { rows } = await db.query(
    `UPDATE reviews r SET organizer_reply = $2, organizer_replied_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, reply],
  );
  return rows[0];
}

const SORTS = Object.freeze({
  newest: 'r.created_at DESC, r.id',
  highest: 'r.rating DESC, r.created_at DESC, r.id',
  lowest: 'r.rating ASC, r.created_at DESC, r.id',
});

/** One page of an event's published reviews. */
async function listPublished(db, { eventId, rating, sort, limit, offset }) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, ${AUTHOR}, count(*) OVER () AS total_count
     FROM reviews r JOIN users u ON u.id = r.user_id
     WHERE r.event_id = $1 AND r.status = 'PUBLISHED' AND ($2::smallint IS NULL OR r.rating = $2)
     ORDER BY ${SORTS[sort]}
     LIMIT $3 OFFSET $4`,
    [eventId, rating ?? null, limit, offset],
  );
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

/** Published reviews per number of stars. @returns {Promise<Record<number, number>>} */
async function distribution(db, eventId) {
  const { rows } = await db.query(
    `SELECT rating, count(*)::int AS n FROM reviews WHERE event_id = $1 AND status = 'PUBLISHED' GROUP BY rating`,
    [eventId],
  );
  return Object.fromEntries([5, 4, 3, 2, 1].map((stars) => [stars, rows.find((r) => r.rating === stars)?.n ?? 0]));
}

/** Admin list. */
async function listForAdmin(db, { eventId, rating, status, q, limit, offset }) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, ${AUTHOR}, u.email AS author_email, e.title AS event_title, e.slug AS event_slug,
            count(*) OVER () AS total_count
     FROM reviews r JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id
     WHERE ($1::uuid IS NULL OR r.event_id = $1)
       AND ($2::smallint IS NULL OR r.rating = $2)
       AND ($3::review_status IS NULL OR r.status = $3)
       AND ($4::text IS NULL OR r.comment ILIKE '%' || $4 || '%' OR e.title ILIKE '%' || $4 || '%')
     ORDER BY r.created_at DESC, r.id
     LIMIT $5 OFFSET $6`,
    [eventId ?? null, rating ?? null, status ?? null, q ?? null, limit, offset],
  );
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

/** Maintenance: events whose figures differ from their published reviews (read without locks: checked again by fixRating). */
async function findRatingMismatches(db) {
  const { rows } = await db.query(
    `SELECT e.id FROM events e
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS n, coalesce(sum(r.rating), 0)::int AS total
       FROM reviews r WHERE r.event_id = e.id AND r.status = 'PUBLISHED'
     ) s ON true
     WHERE e.rating_count <> s.n OR e.rating_sum <> s.total`,
  );
  return rows.map((row) => row.id);
}

/**
 * Recount one event, its row locked first (as every review change does), so a
 * review written meanwhile is never overwritten by an older count.
 * @returns {Promise<boolean>} true if it was wrong
 */
async function fixRating(db, eventId) {
  await lockEvent(db, eventId);
  const { rowCount } = await db.query(
    `UPDATE events e SET rating_count = s.n, rating_sum = s.total
     FROM (SELECT count(*)::int AS n, coalesce(sum(rating), 0)::int AS total
           FROM reviews WHERE event_id = $1 AND status = 'PUBLISHED') s
     WHERE e.id = $1 AND (e.rating_count <> s.n OR e.rating_sum <> s.total)`,
    [eventId],
  );
  return rowCount > 0;
}

module.exports = {
  lockEvent,
  findEvent,
  attendance,
  findMine,
  findById,
  insert,
  update,
  remove,
  adjustRating,
  setStatus,
  setReply,
  listPublished,
  distribution,
  listForAdmin,
  findRatingMismatches,
  fixRating,
  SORTS,
};
