const { sendSuccess } = require('../../utils/response');
const notificationsService = require('./notifications.service');

async function list(req, res) {
  const { notifications, unreadCount, meta } = await notificationsService.listMine(req.user.id, req.valid.query);
  return sendSuccess(res, { notifications, unreadCount }, { meta });
}

async function markRead(req, res) {
  return sendSuccess(res, { notification: await notificationsService.markRead(req.user.id, req.valid.params.id) });
}

async function markAllRead(req, res) {
  return sendSuccess(res, await notificationsService.markAllRead(req.user.id));
}

module.exports = { list, markRead, markAllRead };
