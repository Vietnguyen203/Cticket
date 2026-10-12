const { pool } = require('../../database/pool');
const AppError = require('../../utils/AppError');
const { toLimitOffset, toPageMeta } = require('../../utils/pagination');
const { publish } = require('../../realtime/publisher');
const { MESSAGE, userRoom } = require('../../realtime/messages');
const notificationsRepository = require('./notifications.repository');

const formatVnd = (amount) => `${Number(amount).toLocaleString('vi-VN')}đ`;

/** What the user reads for each notification type (Q-05). */
const COPY = {
  TICKET_ISSUED: ({ orderCode, ticketCount }) => ({
    title: 'Vé của bạn đã sẵn sàng',
    message: `Đơn ${orderCode}: ${ticketCount} vé đã được phát hành. Xem vé và mã QR trong mục Vé của tôi.`,
  }),
  ORDER_EXPIRED: ({ orderCode }) => ({
    title: 'Đơn hàng đã hết hạn',
    message: `Đơn ${orderCode} đã hết thời gian giữ chỗ, các ghế đã được mở bán lại.`,
  }),
  ORDER_CANCELLED: ({ orderCode, reason }) => ({
    title: 'Đơn hàng đã bị hủy',
    message:
      reason === 'EVENT_CANCELLED' || reason === 'SCHEDULE_CANCELLED'
        ? `Đơn ${orderCode} đã bị hủy vì sự kiện / suất diễn bị hủy.`
        : `Đơn ${orderCode} đã được hủy.`,
  }),
  ORDER_REFUNDED: ({ orderCode, amount }) => ({
    title: 'Đã hoàn tiền',
    message: `Đơn ${orderCode} đã được hoàn ${formatVnd(amount ?? 0)}.`,
  }),
};

function toNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    data: row.data,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/** Background job: save the notification, then push it to the user's open sockets. */
async function createNotification({ userId, type, data }) {
  const copy = COPY[type];
  if (!copy) throw new Error(`Unknown notification type: ${type}`);
  const row = await notificationsRepository.insert(pool, { userId, type, data, ...copy(data) });
  await publish(userRoom(userId), { type: MESSAGE.NOTIFICATION, notification: toNotification(row) });
  return row;
}

async function listMine(userId, { unread, page, pageSize }) {
  const { rows, total, unread: unreadCount } = await notificationsRepository.listForUser(pool, {
    userId,
    unreadOnly: unread,
    ...toLimitOffset({ page, pageSize }),
  });
  return { notifications: rows.map(toNotification), unreadCount, meta: toPageMeta({ page, pageSize }, total) };
}

async function markRead(userId, id) {
  const row = await notificationsRepository.markRead(pool, { id, userId });
  if (!row) throw new AppError('NOT_FOUND', 'Notification not found.');
  return toNotification(row);
}

async function markAllRead(userId) {
  return { updated: await notificationsRepository.markAllRead(pool, userId) };
}

module.exports = { createNotification, listMine, markRead, markAllRead };
