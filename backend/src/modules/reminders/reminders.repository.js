/**
 * Phase 18.2: which paid orders are due a reminder (24 hours / 2 hours
 * before the show). See docs/phase-18-customer-features-design.md, section 3.
 */

/**
 * The reminders, and the window in which each is sent: from `hours` before the
 * show until the next one's window opens (a 24-hour reminder that comes too
 * late is skipped, the 2-hour one follows).
 */
const KINDS_SQL = `(VALUES ('24H', 24, 2), ('2H', 2, 0)) AS k(kind, hours, until_hours)`;

/**
 * Claim the due reminders and return what is needed to send them. Claiming
 * is the INSERT itself (primary key order_id + kind, ON CONFLICT DO NOTHING):
 * two workers, or a job run twice, never send one reminder twice.
 * Only orders paid BEFORE the reminder's time (a later buyer just got the
 * confirmation email), with a valid ticket, of a user who wants reminders.
 */
async function claimDue(db, { limit }) {
  const { rows } = await db.query(
    `WITH due AS (
       SELECT o.id AS order_id, k.kind
       FROM ${KINDS_SQL}
       JOIN event_schedules es
         ON es.start_at - make_interval(hours => k.hours) <= now()
        AND es.start_at - make_interval(hours => k.until_hours) > now()
       JOIN events e ON e.id = es.event_id
       JOIN orders o ON o.schedule_id = es.id
       JOIN users u ON u.id = o.user_id
       WHERE es.status = 'SCHEDULED' AND e.status = 'PUBLISHED'
         AND o.status = 'PAID' AND o.paid_at <= es.start_at - make_interval(hours => k.hours)
         AND u.status = 'ACTIVE' AND u.event_reminders
         AND EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = o.id AND t.status = 'VALID')
         AND NOT EXISTS (SELECT 1 FROM order_reminders r WHERE r.order_id = o.id AND r.kind = k.kind)
       ORDER BY es.start_at
       LIMIT $1
     ), claimed AS (
       INSERT INTO order_reminders (order_id, kind)
       SELECT order_id, kind FROM due
       ON CONFLICT DO NOTHING
       RETURNING order_id, kind
     )
     SELECT c.order_id, c.kind, o.user_id, o.order_code, e.title AS event_title, es.start_at
     FROM claimed c
     JOIN orders o ON o.id = c.order_id
     JOIN event_schedules es ON es.id = o.schedule_id
     JOIN events e ON e.id = es.event_id`,
    [limit],
  );
  return rows;
}

module.exports = { claimDue };
