/** Public API of the reminders module (Phase 18.2), for the worker. */
const { sendDueReminders, sendReminderEmail } = require('./reminders.service');

module.exports = { sendDueReminders, sendReminderEmail };
