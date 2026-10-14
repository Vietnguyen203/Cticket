const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { ORGANIZER_STATUS, ROLES } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { toLimitOffset, toPageMeta } = require('../../utils/pagination');
const users = require('../users');
const { recordAudit } = require('../audit');
const organizersRepository = require('./organizers.repository');

/**
 * Allowed status changes, all performed by an admin.
 * Approving also grants the ORGANIZER role (in the same transaction).
 */
const TRANSITIONS = [
  { from: ORGANIZER_STATUS.PENDING, to: ORGANIZER_STATUS.ACTIVE, action: 'ORGANIZER_APPROVED' },
  { from: ORGANIZER_STATUS.PENDING, to: ORGANIZER_STATUS.REJECTED, action: 'ORGANIZER_REJECTED', reasonRequired: true },
  { from: ORGANIZER_STATUS.ACTIVE, to: ORGANIZER_STATUS.SUSPENDED, action: 'ORGANIZER_SUSPENDED', reasonRequired: true },
  { from: ORGANIZER_STATUS.SUSPENDED, to: ORGANIZER_STATUS.ACTIVE, action: 'ORGANIZER_REACTIVATED' },
];

function toPublicOrganizer(row) {
  const organizer = {
    id: row.id,
    userId: row.user_id,
    organizationName: row.organization_name,
    description: row.description,
    taxCode: row.tax_code,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.user_email !== undefined) {
    organizer.userEmail = row.user_email;
  }
  return organizer;
}

/**
 * A user applies to become an organizer (status PENDING).
 * One profile per user (UNIQUE user_id); a REJECTED applicant may apply again.
 */
async function apply(context, body) {
  const row = await withTransaction(async (client) => {
    const existing = await organizersRepository.findByUserId(client, context.userId, { forUpdate: true });
    if (!existing) {
      // If two applications race, the UNIQUE index rejects the second → 409.
      return organizersRepository.insert(client, { userId: context.userId, ...body });
    }
    if (existing.status !== ORGANIZER_STATUS.REJECTED) {
      throw new AppError('ORGANIZER_ALREADY_EXISTS');
    }
    const reapplied = await organizersRepository.reapply(client, existing.id, body);
    await recordAudit(client, {
      context,
      action: 'ORGANIZER_REAPPLIED',
      entityType: 'organizer',
      entityId: existing.id,
      oldValue: { status: existing.status },
      newValue: { status: reapplied.status },
    });
    return reapplied;
  });
  return toPublicOrganizer(row);
}

async function getMyOrganizer(userId) {
  const row = await organizersRepository.findByUserId(pool, userId);
  if (!row) {
    throw new AppError('NOT_FOUND', 'You have no organizer profile.');
  }
  return toPublicOrganizer(row);
}

async function listOrganizers({ status, page, pageSize }) {
  const { rows, total } = await organizersRepository.list(pool, { status, ...toLimitOffset({ page, pageSize }) });
  return { organizers: rows.map(toPublicOrganizer), meta: toPageMeta({ page, pageSize }, total) };
}

/**
 * Admin changes an organizer's status. The row is locked first, so two admins
 * acting at the same time are serialized: the second sees the new status and
 * gets 409 INVALID_STATE_TRANSITION instead of applying a stale change.
 */
async function changeStatus(context, organizerId, { status, reason }) {
  const row = await withTransaction(async (client) => {
    // Lock order users → organizers (as the admin Users page does): read the
    // profile to learn whose it is, lock that user, then lock the profile.
    const found = await organizersRepository.findById(client, organizerId);
    if (!found) {
      throw new AppError('NOT_FOUND', 'Organizer not found.');
    }
    await users.lockUser(client, found.user_id);
    const organizer = await organizersRepository.findById(client, organizerId, { forUpdate: true });
    const transition = TRANSITIONS.find((t) => t.from === organizer.status && t.to === status);
    if (!transition) {
      throw new AppError('INVALID_STATE_TRANSITION', `Cannot change an organizer from ${organizer.status} to ${status}.`);
    }
    if (transition.reasonRequired && !reason) {
      throw new AppError('REASON_REQUIRED');
    }

    const updated = await organizersRepository.updateStatus(client, organizerId, { from: organizer.status, to: status });
    if (status === ORGANIZER_STATUS.ACTIVE) {
      // Takes effect in the user's access token at their next /auth/refresh.
      await users.addRole(client, organizer.user_id, ROLES.ORGANIZER);
    }
    await recordAudit(client, {
      context,
      action: transition.action,
      entityType: 'organizer',
      entityId: organizerId,
      oldValue: { status: organizer.status },
      newValue: { status, reason: reason ?? null },
    });
    return updated;
  });
  return toPublicOrganizer(row);
}

/**
 * Admin Users page (USR-05): making a user ORGANIZER also makes their profile
 * usable — created and named after the user if missing, activated if it is
 * pending, rejected or suspended (granting the role is the approval).
 * The caller holds the user row lock (lock order users → organizers).
 * @param {{ id: string, first_name: string, last_name: string }} user
 */
async function activateForUser(client, context, user) {
  const existing = await organizersRepository.findByUserId(client, user.id, { forUpdate: true });
  if (existing?.status === ORGANIZER_STATUS.ACTIVE) return existing;
  const profile =
    existing ??
    // Vietnamese order, as the admin pages show it: family name, then given name.
    (await organizersRepository.insert(client, { userId: user.id, organizationName: `${user.last_name} ${user.first_name}`.trim() }));
  const row = await organizersRepository.updateStatus(client, profile.id, { from: profile.status, to: ORGANIZER_STATUS.ACTIVE });
  await recordAudit(client, {
    context,
    action: existing ? 'ORGANIZER_APPROVED' : 'ORGANIZER_CREATED',
    entityType: 'organizer',
    entityId: row.id,
    oldValue: existing ? { status: existing.status } : null,
    newValue: { status: ORGANIZER_STATUS.ACTIVE, reason: 'ORGANIZER role granted by an admin' },
  });
  return row;
}

/** For other modules: the organizer profile of a user, or null. */
async function findOrganizerByUserId(userId) {
  return organizersRepository.findByUserId(pool, userId);
}

module.exports = { apply, getMyOrganizer, listOrganizers, changeStatus, activateForUser, findOrganizerByUserId, toPublicOrganizer };
