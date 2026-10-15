/** Public API of the reminders module (Phase 18.2), for the worker. */
const { sendDueReminders, sendReminderEmail, sendReviewInviteEmail } = require('./reminders.service');

module.exports = { sendDueReminders, sendReminderEmail, sendReviewInviteEmail };
