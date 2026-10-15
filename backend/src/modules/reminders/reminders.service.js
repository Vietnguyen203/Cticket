const { pool } = require('../../database/pool');
const { ORDER_STATUS, SCHEDULE_STATUS, TICKET_STATUS, CHECKIN } = require('../../config/constants');
const { QUEUE, enqueue } = require('../../queue/queues');
const mailer = require('../../mail/mailer');
const { eventReminderEmail } = require('../../mail/templates');
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
  return { sent: due.length };
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

module.exports = { sendDueReminders, sendReminderEmail };
