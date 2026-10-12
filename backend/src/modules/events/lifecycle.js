/**
 * After the show (Phase 9 job "finish-shows", every 10 minutes):
 * schedules whose end time has passed → FINISHED; an event whose schedules
 * are all over (finished or cancelled, at least one finished) → FINISHED.
 * Runs in the caller's transaction; compare-and-set updates make it safe to
 * run twice or on two workers at once.
 * @returns {Promise<{ scheduleIds: string[], eventIds: string[] }>}
 */
async function finishPastShows(db) {
  const schedules = await db.query(
    `UPDATE event_schedules SET status = 'FINISHED'
     WHERE status = 'SCHEDULED' AND end_at <= now()
     RETURNING id`,
  );
  const events = await db.query(
    `UPDATE events e SET status = 'FINISHED'
     WHERE e.status = 'PUBLISHED'
       AND NOT EXISTS (SELECT 1 FROM event_schedules s WHERE s.event_id = e.id AND s.status = 'SCHEDULED')
       AND EXISTS (SELECT 1 FROM event_schedules s WHERE s.event_id = e.id AND s.status = 'FINISHED')
     RETURNING e.id`,
  );
  return { scheduleIds: schedules.rows.map((row) => row.id), eventIds: events.rows.map((row) => row.id) };
}

module.exports = { finishPastShows };
