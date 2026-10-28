const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const env = require('../../config/env');
const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { USER_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { recordAudit } = require('../audit');
const auth = require('../auth');
const users = require('../users');
const repository = require('./account.repository');

/**
 * A user's rights over their own personal data (Luật Bảo vệ dữ liệu cá nhân
 * 2025; Điều 10 of the terms of sale, frontend/src/legal/terms.ts):
 *  - export: everything the platform holds about them, as a JSON file;
 *  - deletion: personal data removed, the account closed for good.
 *
 * What a deletion keeps, and why: orders, payments, refunds and tickets stay
 * (anonymised: the buyer is "Người dùng đã xóa") because the accounts of the
 * organizers and the platform, refunds still to come and tax records depend
 * on them. Ratings stay in the events' averages; the words of the reviews go.
 */

/** Why a deletion cannot happen now; the web page says what to do for each. */
const BLOCKERS = ['admin', 'organizer_events', 'open_order', 'upcoming_tickets', 'pending_refund'];

const toReasons = (row) => BLOCKERS.filter((key) => row[key]).map((key) => key.toUpperCase());

/** GET /users/me/data */
async function exportData(userId) {
  const profile = await repository.profile(pool, userId);
  if (!profile) throw new AppError('UNAUTHENTICATED');
  const [sessions, orders, tickets, reviews, waitlist, notifications, organizer] = await Promise.all([
    repository.sessions(pool, userId),
    repository.orders(pool, userId),
    repository.tickets(pool, userId),
    repository.reviews(pool, userId),
    repository.waitlist(pool, userId),
    repository.notifications(pool, userId),
    repository.organizer(pool, userId),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    about:
      'Dữ liệu cá nhân ETP Tickets đang lưu về bạn (Luật Bảo vệ dữ liệu cá nhân 2025). Không gồm mật khẩu, mã QR vé và mã xác thực hai lớp: các mã bí mật này không bao giờ được xuất ra.',
    account: {
      email: profile.email,
      firstName: profile.first_name,
      lastName: profile.last_name,
      phone: profile.phone,
      status: profile.status,
      roles: profile.roles ?? [],
      emailVerifiedAt: profile.email_verified_at,
      twoFactorEnabledAt: profile.two_factor_enabled_at,
      eventReminders: profile.event_reminders,
      createdAt: profile.created_at,
    },
    sessions: sessions.map((s) => ({ signedInAt: s.created_at, expiresAt: s.expires_at, ipAddress: s.ip_address, userAgent: s.user_agent })),
    orders: orders.map((o) => ({
      orderCode: o.order_code,
      status: o.status,
      event: o.event_title,
      showStartsAt: o.start_at,
      venue: o.venue_name,
      items: o.items,
      subtotal: o.subtotal,
      discount: o.discount_amount,
      total: o.total_amount,
      currency: o.currency,
      termsOfSale: o.terms_version ? { version: o.terms_version, acceptedAt: o.terms_accepted_at, refundPolicy: o.refund_policy } : null,
      createdAt: o.created_at,
      paidAt: o.paid_at,
      cancelledAt: o.cancelled_at,
      cancelReason: o.cancel_reason,
      payments: o.payments,
      refunds: o.refunds,
    })),
    tickets: tickets.map((t) => ({
      ticketCode: t.ticket_code,
      status: t.status,
      event: t.event_title,
      showStartsAt: t.start_at,
      seat: t.seat_label,
      ticketType: t.ticket_type_name,
      issuedAt: t.issued_at,
      checkedInAt: t.checked_in_at,
      cancelledAt: t.cancelled_at,
    })),
    reviews: reviews.map((r) => ({
      event: r.event_title,
      rating: r.rating,
      comment: r.comment,
      status: r.status,
      hiddenReason: r.hidden_reason,
      organizerReply: r.organizer_reply,
      createdAt: r.created_at,
    })),
    waitlist: waitlist.map((w) => ({
      event: w.event_title,
      showStartsAt: w.start_at,
      ticketType: w.ticket_type,
      quantity: w.quantity,
      status: w.status,
      offeredAt: w.offered_at,
      createdAt: w.created_at,
    })),
    notifications: notifications.map((n) => ({ type: n.type, title: n.title, message: n.message, readAt: n.read_at, createdAt: n.created_at })),
    organizer: organizer && {
      organizationName: organizer.organization_name,
      description: organizer.description,
      taxCode: organizer.tax_code,
      status: organizer.status,
      events: organizer.events,
      createdAt: organizer.created_at,
    },
  };
}

/** GET /users/me/deletion: can this account be deleted now, and if not, why. */
async function deletionCheck(userId) {
  const reasons = toReasons(await repository.blockers(pool, userId));
  return { allowed: reasons.length === 0, reasons };
}

/**
 * DELETE /users/me: the password again (a forgotten open tab must not be
 * enough), then, in one transaction: the account anonymised, personal rows
 * deleted, every session ended. Not undoable.
 */
async function deleteAccount(context, userId, { password }) {
  const user = await users.findById(pool, userId);
  if (!user || user.status === USER_STATUS.DELETED) throw new AppError('UNAUTHENTICATED');
  if (!(await bcrypt.compare(password, user.password_hash))) throw new AppError('WRONG_PASSWORD');
  const unusable = await unusablePasswordHash();
  await withTransaction(async (client) => {
    await users.lockUser(client, userId);
    await closeAccount(client, { userId, email: user.email, unusable, context, audit: { action: 'ACCOUNT_DELETED' } });
  });
  return { deleted: true };
}

/** A hash of random bytes nobody knows: no password can ever match it. */
const unusablePasswordHash = () => bcrypt.hash(randomBytes(32).toString('hex'), env.BCRYPT_COST);

/**
 * The deletion itself, in the caller's transaction (user row locked):
 * blockers checked again, personal rows deleted, the account anonymised,
 * every session ended once committed. Orders, payments, refunds and tickets
 * stay, anonymised (see the top of this file). Used by DELETE /users/me and
 * by an admin's "Xóa vĩnh viễn" (admin module).
 */
async function closeAccount(client, { userId, email, unusable, context, audit }) {
  const reasons = toReasons(await repository.blockers(client, userId));
  if (reasons.length > 0) throw new AppError('ACCOUNT_DELETION_BLOCKED', undefined, { details: { reasons } });
  await repository.deletePersonalRows(client, userId);
  await repository.anonymise(client, userId, unusable);
  await auth.clearLoginLock(client, email);
  await recordAudit(client, { context, entityType: 'user', entityId: userId, ...audit });
  // Access tokens already issued stop at once (refresh tokens are gone above).
  client.afterCommit(() => auth.revokeAllTokensOfUser(userId, { strict: true }));
}

module.exports = { exportData, deletionCheck, deleteAccount, closeAccount, unusablePasswordHash };
