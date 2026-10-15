const { pool } = require('../../database/pool');
const { ORDER_STATUS, SCHEDULE_STATUS, TICKET_STATUS, CHECKIN, REVIEW } = require('../../config/constants');
const { QUEUE, enqueue } = require('../../queue/queues');
const mailer = require('../../mail/mailer');
const { eventReminderEmail, reviewInviteEmail } = require('../../mail/templates');
const tickets = require('../tickets');
const remindersRepository = require('./reminders.repository');

/**
 * Phase 18.2: an email and an in-app notification 24 hours and 2 hours before
 * the show. See docs/phase-18-customer-features-design.md, section 3.
 */

// Per run of the maintenance job (every 5 minutes); the rest waits for the next run.
const BATCH_SIZE = 500;

/** Maintenance job: claim the due reminders, queue their email and notification. */
async function sendDueReminders() {
  const due = await remindersRepository.claimDue(pool, { limit: BATCH_SIZE });
  for (const row of due) {
    await enqueue(QUEUE.EMAILS, 'event-reminder', { orderId: row.order_id, kind: row.kind }, {
      jobId: `event-reminder-${row.order_id}-${row.kind}`,
    });
    await enqueue(QUEUE.NOTIFICATIONS, 'notify', {
      userId: row.user_id,
      type: 'EVENT_REMINDER',
      data: { orderId: row.order_id, orderCode: row.order_code, eventTitle: row.event_title, startAt: row.start_at, kind: row.kind },
    });
  }
  // Phase 19: "how was the show?" a day after it.
  const invites = await remindersRepository.claimDueReviewInvites(pool, { hoursAfter: REVIEW.INVITE_HOURS_AFTER_SHOW, limit: BATCH_SIZE });
  for (const orderId of invites) {
    await enqueue(QUEUE.EMAILS, 'review-invite', { orderId }, { jobId: `review-invite-${orderId}` });
  }
  return { sent: due.length, reviewInvites: invites.length };
}

/** Emails queue (Phase 19). Reviewed or turned off since the claim → nothing. */
async function sendReviewInviteEmail({ orderId }) {
  const { rows } = await pool.query(
    `SELECT u.email, u.first_name, u.event_reminders, e.title AS event_title, es.start_at,
            EXISTS (SELECT 1 FROM reviews r WHERE r.user_id = o.user_id AND r.event_id = e.id) AS reviewed
     FROM orders o
     JOIN users u ON u.id = o.user_id
     JOIN event_schedules es ON es.id = o.schedule_id
     JOIN events e ON e.id = es.event_id
     WHERE o.id = $1`,
    [orderId],
  );
  const row = rows[0];
  if (!row || row.reviewed || !row.event_reminders) return 'skipped';
  await mailer.sendMail({ to: row.email, ...reviewInviteEmail(row) });
  return 'sent';
}

/** Emails queue. Checked again: refunded, cancelled or turned off since the claim → nothing. */
async function sendReminderEmail({ orderId, kind }) {
  const confirmation = await tickets.confirmationOf(orderId);
  if (!confirmation) return 'skipped';
  const { order } = confirmation;
  const valid = confirmation.tickets.filter((ticket) => ticket.status === TICKET_STATUS.VALID);
  if (
    order.status !== ORDER_STATUS.PAID ||
    order.schedule_status !== SCHEDULE_STATUS.SCHEDULED ||
    !order.event_reminders ||
    valid.length === 0
  ) {
    return 'skipped';
  }
  const gatesOpenAt = new Date(new Date(order.start_at).getTime() - CHECKIN.OPENS_MINUTES_BEFORE_START * 60_000);
  await mailer.sendMail({ to: order.email, ...eventReminderEmail({ order, tickets: valid, kind, gatesOpenAt }) });
  return 'sent';
}

module.exports = { sendDueReminders, sendReminderEmail, sendReviewInviteEmail };
