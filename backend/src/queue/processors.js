const { withTransaction } = require('../database/transaction');
const { pool } = require('../database/pool');
const { ORDER_STATUS } = require('../config/constants');
const mailer = require('../mail/mailer');
const { orderConfirmedEmail, orderRefundedEmail } = require('../mail/templates');
const { invalidate, NAMESPACE } = require('../redis/cache');
const auth = require('../modules/auth');
const events = require('../modules/events');
const orders = require('../modules/orders');
const tickets = require('../modules/tickets');
const notifications = require('../modules/notifications');
const payments = require('../modules/payments');
const reminders = require('../modules/reminders');
const waitlist = require('../modules/waitlist');
const purchaseQueue = require('../modules/purchase-queue');
const reviews = require('../modules/reviews');
const { QUEUE } = require('./queues');

/**
 * What each job does. Every handler is safe to run more than once: the
 * domain functions it calls are idempotent (unique constraints,
 * compare-and-set updates). A handler throws to make BullMQ retry the job.
 */

async function sendOrderConfirmation({ orderId }) {
  const confirmation = await tickets.confirmationOf(orderId);
  // Refunded meanwhile, or nothing issued yet: nothing to confirm.
  if (!confirmation || confirmation.order.status !== ORDER_STATUS.PAID || confirmation.tickets.length === 0) return 'skipped';
  // Phase 20: the tickets as a PDF (sent without it if it cannot be made).
  const attachment = await tickets.pdfAttachment({ orderId, filename: `Ve-${confirmation.order.order_code}.pdf` });
  await mailer.sendMail({ to: confirmation.order.email, ...orderConfirmedEmail(confirmation), attachments: attachment ? [attachment] : [] });
  return 'sent';
}

async function sendRefundConfirmation({ orderId }) {
  const confirmation = await tickets.confirmationOf(orderId);
  if (!confirmation || confirmation.order.status !== ORDER_STATUS.REFUNDED) return 'skipped';
  await mailer.sendMail({ to: confirmation.order.email, ...orderRefundedEmail(confirmation) });
  return 'sent';
}

/** After the show: schedules / events FINISHED, their paid orders COMPLETED, in one transaction. */
async function finishShows() {
  const result = await withTransaction(async (client) => {
    const { scheduleIds, eventIds } = await events.finishPastShows(client);
    const completedOrders = await orders.completeOrdersOfFinishedSchedules(client);
    return { schedules: scheduleIds.length, events: eventIds.length, completedOrders };
  });
  if (result.schedules > 0 || result.events > 0) await invalidate(NAMESPACE.CATALOG);
  return result;
}

const HANDLERS = {
  [QUEUE.TICKETS]: {
    issue: ({ orderId }) => tickets.issueTicketsForOrder(orderId),
  },
  [QUEUE.EMAILS]: {
    otp: (data) => auth.sendOtpEmail(data),
    'two-factor-alert': (data) => auth.sendTwoFactorAlert(data),
    'order-confirmed': sendOrderConfirmation,
    'order-refunded': sendRefundConfirmation,
    'payment-returned': (data) => payments.sendPaymentReturnedEmail(data), // Phase 17: late VNPay money
    'login-locked': (data) => auth.sendLoginLockedEmail(data), // Phase 18.1
    'ticket-qr-reissued': (data) => tickets.sendQrReissuedEmail(data), // Phase 20
    'event-reminder': (data) => reminders.sendReminderEmail(data), // Phase 18.2
    'waitlist-offer': (data) => waitlist.sendOfferEmail(data), // Phase 18.4
    'review-invite': (data) => reminders.sendReviewInviteEmail(data), // Phase 19
  },
  [QUEUE.HOLDS]: {
    expire: ({ orderId }) => orders.expireOrder(orderId),
  },
  [QUEUE.NOTIFICATIONS]: {
    notify: (data) => notifications.createNotification(data),
    // Phase 18.4: built when it runs (the offer may have ended meanwhile).
    'notify-waitlist': async (data) => {
      const notification = await waitlist.offerNotification(data);
      return notification ? notifications.createNotification(notification) : 'skipped';
    },
  },
  [QUEUE.MAINTENANCE]: {
    'reconcile-tickets': () => tickets.reconcileTickets(),
    'sweep-holds': () => orders.expireDueOrders(),
    'finish-shows': finishShows,
    'reconcile-payments': () => payments.reconcileGatewayPayments(), // Phase 17
    'purge-login-attempts': () => auth.purgeLoginAttempts(pool), // Phase 18.1
    'send-reminders': () => reminders.sendDueReminders(), // Phase 18.2
    'offer-waitlist': () => waitlist.offerSpacesToWaitlist(), // Phase 18.4
    'reconcile-ratings': () => reviews.reconcileRatings(), // Phase 19
    'admit-queues': () => purchaseQueue.admitQueues(), // Phase 21
  },
  [QUEUE.PAYMENTS]: {
    'vnpay-refund': (data, job) => payments.processVnpayRefund(data, job),
  },
};

/** Run one job (by the BullMQ worker, or inline in tests). */
async function run(queueName, job) {
  const handler = HANDLERS[queueName]?.[job.name];
  if (!handler) throw new Error(`No handler for job ${queueName}/${job.name}`);
  return handler(job.data, job);
}

module.exports = { run, HANDLERS };
