const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { ROLES, USER_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { toLimitOffset, toPageMeta } = require('../../utils/pagination');
const { recordAudit } = require('../audit');
const auth = require('../auth');
const organizers = require('../organizers');
const account = require('../account/account.service');
const adminUsersRepository = require('./admin-users.repository');

function toAdminUser(row) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    roles: row.roles,
    twoFactorEnabled: row.two_factor_enabled,
    // Phase 18.1: sign-in paused after wrong passwords, until this time (null = not locked).
    loginLockedUntil: row.login_locked_until ?? null,
    createdAt: row.created_at,
  };
}

const userNotFound = () => new AppError('NOT_FOUND', 'User not found.');

/** USR-03 */
async function listUsers({ q, role, status, page, pageSize }) {
  const { rows, total } = await adminUsersRepository.list(pool, { q, role, status, ...toLimitOffset({ page, pageSize }) });
  const locks = await auth.loginLockedUntilOf(pool, rows.map((row) => row.email));
  return {
    users: rows.map((row) => toAdminUser({ ...row, login_locked_until: locks.get(row.email) })),
    meta: toPageMeta({ page, pageSize }, total),
  };
}

/**
 * Log the user out everywhere, now: refresh tokens revoked (no new access
 * tokens) and every access token already issued refused (Redis denylist,
 * Phase 6), instead of working for up to 15 more minutes. After COMMIT, so a
 * rolled-back change never logs anyone out.
 */
function endSessionsAfterCommit(client, userId) {
  client.afterCommit(() => auth.revokeAllTokensOfUser(userId, { strict: true }));
  return auth.revokeSessionsOfUser(client, userId);
}

/**
 * USR-04: suspend (logged out at once) or reactivate. An account that never
 * verified its email goes back to PENDING_VERIFICATION, not ACTIVE.
 */
async function changeStatus(context, adminId, userId, { status, reason }) {
  if (userId === adminId) throw new AppError('CANNOT_CHANGE_SELF');
  return withTransaction(async (client) => {
    const user = await adminUsersRepository.findForUpdate(client, userId);
    if (!user) throw userNotFound();
    if (user.status === USER_STATUS.DELETED) throw new AppError('ACCOUNT_DELETED');
    if (user.status === USER_STATUS.SUSPENDED && status === USER_STATUS.SUSPENDED) return toAdminUser(user);

    let next = status;
    if (status === USER_STATUS.SUSPENDED) {
      if (user.roles.includes(ROLES.ADMIN)) {
        const admins = await adminUsersRepository.lockActiveAdmins(client);
        if (admins.filter((id) => id !== userId).length === 0) throw new AppError('LAST_ADMIN');
      }
      await endSessionsAfterCommit(client, userId);
    } else if (user.status === USER_STATUS.SUSPENDED) {
      next = user.email_verified_at ? USER_STATUS.ACTIVE : USER_STATUS.PENDING_VERIFICATION;
    } else {
      return toAdminUser(user); // already active / waiting for verification
    }

    await adminUsersRepository.setStatus(client, userId, next);
    await recordAudit(client, {
      context,
      action: next === USER_STATUS.SUSPENDED ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
      entityType: 'user',
      entityId: userId,
      oldValue: { status: user.status },
      newValue: { status: next, reason: reason ?? null },
    });
    return toAdminUser({ ...user, status: next });
  });
}

/**
 * "Xóa vĩnh viễn": the admin deletes an account for good, as its owner can
 * (DELETE /users/me): personal data removed, the person logged out
 * everywhere, the email freed. Orders, payments, refunds and tickets stay,
 * anonymised, for the accounts. The same blockers apply (open order, show
 * still to come, refund in progress, organizer with events, admin role).
 * Never one's own account. Not undoable; the reason goes to the audit log.
 */
async function deletePermanently(context, adminId, userId, { reason }) {
  if (userId === adminId) throw new AppError('CANNOT_CHANGE_SELF');
  const unusable = await account.unusablePasswordHash();
  await withTransaction(async (client) => {
    const user = await adminUsersRepository.findForUpdate(client, userId);
    if (!user) throw userNotFound();
    if (user.status === USER_STATUS.DELETED) throw new AppError('ACCOUNT_DELETED');
    await account.closeAccount(client, {
      userId,
      email: user.email,
      unusable,
      context,
      audit: { action: 'ACCOUNT_DELETED_BY_ADMIN', oldValue: { status: user.status }, newValue: { status: USER_STATUS.DELETED, reason } },
    });
  });
  return { deleted: true };
}

/**
 * USR-05: set the user's roles (CUSTOMER is always kept). The system always
 * keeps at least one active admin, and an admin cannot drop their own ADMIN
 * role. A removed role is gone at once (sessions ended); an added one shows
 * at the user's next token refresh.
 */
async function setRoles(context, adminId, userId, { roles }) {
  const wanted = [...new Set([ROLES.CUSTOMER, ...roles])].sort();
  return withTransaction(async (client) => {
    const user = await adminUsersRepository.findForUpdate(client, userId);
    if (!user) throw userNotFound();
    if (user.status === USER_STATUS.DELETED) throw new AppError('ACCOUNT_DELETED');
    const losesAdmin = user.roles.includes(ROLES.ADMIN) && !wanted.includes(ROLES.ADMIN);
    if (losesAdmin) {
      if (userId === adminId) throw new AppError('CANNOT_CHANGE_SELF', 'You cannot remove your own administrator role.');
      const admins = await adminUsersRepository.lockActiveAdmins(client);
      if (admins.filter((id) => id !== userId).length === 0) throw new AppError('LAST_ADMIN');
    }
    // An organizer needs a usable organizer profile, not only the role.
    if (wanted.includes(ROLES.ORGANIZER)) await organizers.activateForUser(client, context, user);
    if (wanted.join() === [...user.roles].sort().join()) return toAdminUser(user);

    await adminUsersRepository.replaceRoles(client, userId, wanted);
    if (user.roles.some((role) => !wanted.includes(role))) await endSessionsAfterCommit(client, userId);
    await recordAudit(client, {
      context,
      action: 'USER_ROLES_CHANGED',
      entityType: 'user',
      entityId: userId,
      oldValue: { roles: user.roles },
      newValue: { roles: wanted },
    });
    return toAdminUser({ ...user, roles: wanted });
  });
}

/**
 * Phase 15: turn off the two-factor of someone who lost their phone (and
 * their recovery codes). They are logged out everywhere; an admin will have
 * to set it up again at the next login. Never for oneself: another admin
 * must do it (or the server script, when there is no other admin).
 */
async function resetTwoFactor(context, adminId, userId, { reason }) {
  if (userId === adminId) throw new AppError('CANNOT_CHANGE_SELF');
  const user = await withTransaction(async (client) => {
    const found = await adminUsersRepository.findForUpdate(client, userId);
    if (!found) throw userNotFound();
    if (!(await auth.resetTwoFactor(client, userId))) throw new AppError('TWO_FACTOR_NOT_ENABLED');
    await endSessionsAfterCommit(client, userId);
    await recordAudit(client, {
      context,
      action: 'TWO_FACTOR_RESET',
      entityType: 'user',
      entityId: userId,
      oldValue: { twoFactorEnabled: found.two_factor_enabled },
      newValue: { twoFactorEnabled: false, reason },
    });
    return { ...found, two_factor_enabled: false };
  });
  await auth.alertTwoFactorReset(user);
  return toAdminUser(user);
}

/** Phase 18.1: end a login lock early (the owner called support, it was not them…). */
async function unlockLogin(context, userId) {
  return withTransaction(async (client) => {
    const user = await adminUsersRepository.findForUpdate(client, userId);
    if (!user) throw userNotFound();
    await auth.clearLoginLock(client, user.email);
    await recordAudit(client, { context, action: 'LOGIN_UNLOCKED', entityType: 'user', entityId: userId });
    return toAdminUser(user);
  });
}

module.exports = { listUsers, changeStatus, deletePermanently, setRoles, resetTwoFactor, unlockLogin };
