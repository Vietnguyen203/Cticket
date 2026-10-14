/**
 * event_staff: who may check in tickets of which event (n-n, Phase 1 table).
 */

/** @returns {Promise<boolean>} false if the person was already assigned */
async function assign(db, { eventId, userId, assignedBy }) {
  const { rowCount } = await db.query(
    `INSERT INTO event_staff (event_id, user_id, assigned_by) VALUES ($1, $2, $3)
     ON CONFLICT (event_id, user_id) DO NOTHING`,
    [eventId, userId, assignedBy],
  );
  return rowCount === 1;
}

async function remove(db, { eventId, userId }) {
  const { rowCount } = await db.query(`DELETE FROM event_staff WHERE event_id = $1 AND user_id = $2`, [eventId, userId]);
  return rowCount === 1;
}

async function listByEvent(db, eventId) {
  const { rows } = await db.query(
    `SELECT u.id AS user_id, u.email, u.first_name, u.last_name, s.created_at AS assigned_at
     FROM event_staff s JOIN users u ON u.id = s.user_id
     WHERE s.event_id = $1
     ORDER BY s.created_at, u.email`,
    [eventId],
  );
  return rows;
}

async function isStaff(db, { eventId, userId }) {
  const { rows } = await db.query(`SELECT 1 FROM event_staff WHERE event_id = $1 AND user_id = $2`, [eventId, userId]);
  return rows.length > 0;
}

/** Everyone who follows an event's gates live: its staff and the organizer who owns it. */
async function audienceOf(db, eventId) {
  const { rows } = await db.query(
    `SELECT user_id FROM event_staff WHERE event_id = $1
     UNION
     SELECT o.user_id FROM events e JOIN organizers o ON o.id = e.organizer_id WHERE e.id = $1`,
    [eventId],
  );
  return rows.map((row) => row.user_id);
}

/**
 * Events whose gates `userId` works, with their schedules that have not ended.
 * `all`: every open event instead (admins may scan any event).
 */
async function eventsOfStaff(db, userId, { all = false } = {}) {
  const { rows } = await db.query(
    `SELECT e.id, e.title, e.status,
            coalesce(json_agg(json_build_object(
              'id', es.id, 'startAt', es.start_at, 'endAt', es.end_at, 'status', es.status, 'venueName', v.name
            ) ORDER BY es.start_at) FILTER (WHERE es.id IS NOT NULL), '[]') AS schedules
     FROM events e
     LEFT JOIN event_schedules es ON es.event_id = e.id AND es.status = 'SCHEDULED' AND es.end_at > now()
     LEFT JOIN venues v ON v.id = es.venue_id
     WHERE e.status IN ('PUBLISHED', 'DRAFT', 'PENDING_APPROVAL')
       AND ($2::boolean OR EXISTS (SELECT 1 FROM event_staff s WHERE s.event_id = e.id AND s.user_id = $1))
     GROUP BY e.id
     ORDER BY min(es.start_at) NULLS LAST, e.title`,
    [userId, all],
  );
  return rows;
}

module.exports = { assign, remove, listByEvent, isStaff, audienceOf, eventsOfStaff };
