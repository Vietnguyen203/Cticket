const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { PG_ERROR } = require('../../database/errors');
const { EVENT_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { uniqueSlug } = require('../../utils/slug');
const { toLimitOffset, toPageMeta } = require('../../utils/pagination');
const { recordAudit } = require('../audit');
const eventsRepository = require('./events.repository');
const schedulesRepository = require('./schedules.repository');
const { PUBLIC_STATUSES, canManage, canView, eventNotFound, lockManageableEvent } = require('./event-access');
const { findTransition } = require('./event-status');
const { toPublicSchedule } = require('./schedules.mapper');
const inventoryService = require('./inventory.service');
const { remember, invalidatesAfter, keyOf, NAMESPACE, TTL } = require('../../redis/cache');
const orders = require('../orders');
const venues = require('../venues');
const payments = require('../payments');

const SLUG_CONSTRAINT = 'events_slug_key';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fields an organizer may still change after the event is PUBLISHED. */
const EDITABLE_WHEN_PUBLISHED = ['description', 'bannerUrl', 'thumbnailUrl'];

function toEventSummary(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    thumbnailUrl: row.thumbnail_url,
    status: row.status,
    publishedAt: row.published_at,
    nextStartAt: row.next_start_at,
    cities: row.cities,
    organizer: { id: row.organizer_id, name: row.organizer_name },
    categories: row.categories,
  };
}

function toEventDetail(row, schedules) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    bannerUrl: row.banner_url,
    thumbnailUrl: row.thumbnail_url,
    ageRestriction: row.age_restriction,
    status: row.status,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    organizer: { id: row.organizer_id, name: row.organizer_name },
    categories: row.categories,
    schedules: schedules.map(toPublicSchedule),
  };
}

async function loadDetail(db, eventId) {
  const row = await eventsRepository.findDetail(db, { id: eventId });
  return toEventDetail(row, await schedulesRepository.listByEvent(db, eventId));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function createEvent(context, actor, body) {
  if (!actor.organizerId) {
    throw new AppError('ORGANIZER_PROFILE_REQUIRED');
  }
  const insert = () =>
    withTransaction(async (client) => {
      const eventId = await eventsRepository.insertEvent(client, {
        ...body,
        organizerId: actor.organizerId,
        slug: uniqueSlug(body.title),
      });
      await eventsRepository.replaceCategories(client, eventId, body.categoryIds);
      return loadDetail(client, eventId);
    });

  try {
    return await insert();
  } catch (err) {
    // The random slug suffix makes a collision very unlikely; if it happens,
    // the UNIQUE constraint caught it and one retry with a new suffix is enough.
    if (err.code === PG_ERROR.UNIQUE_VIOLATION && err.constraint === SLUG_CONSTRAINT) {
      return insert();
    }
    throw err;
  }
}

/**
 * DRAFT: every field. PUBLISHED: only description and images (buyers rely on
 * the title, times and categories they saw). Other statuses: nothing.
 */
async function updateEvent(context, actor, eventId, changes) {
  return withTransaction(async (client) => {
    const event = await lockManageableEvent(client, actor, eventId);

    if (event.status === EVENT_STATUS.PUBLISHED) {
      const locked = Object.keys(changes).filter((key) => !EDITABLE_WHEN_PUBLISHED.includes(key));
      if (locked.length > 0) {
        throw new AppError('EVENT_NOT_EDITABLE', 'Only description and images can change after publishing.', {
          details: locked.map((field) => ({ field: `body.${field}`, message: 'cannot change after publishing' })),
        });
      }
    } else if (event.status !== EVENT_STATUS.DRAFT) {
      throw new AppError('EVENT_NOT_EDITABLE');
    }

    const { categoryIds, ...fields } = changes;
    await eventsRepository.updateEvent(client, eventId, fields);
    if (categoryIds) {
      await eventsRepository.replaceCategories(client, eventId, categoryIds);
    }
    return loadDetail(client, eventId);
  });
}

/** Only a DRAFT can be deleted (nothing was ever sold or visible). */
/** What deleting the event would remove: shown before its owner / an admin confirms. */
async function deletionSummary(actor, eventId) {
  const event = await eventsRepository.findById(pool, eventId);
  if (!event || !canManage(actor, event)) throw eventNotFound();
  return { title: event.title, status: event.status, ...(await orders.summarizeEventSales(pool, eventId)) };
}

/**
 * Delete an event for good (its organizer or an admin), whatever its status,
 * with everything its schedules sold (orders, tickets, payments, check-ins:
 * orders/order-purge.js). A draft without orders goes at once; any other event
 * only with `confirmTitle` equal to its title, so a stray API call or click
 * cannot wipe a sold-out show. Audited with what was removed.
 */
async function deleteEvent(context, actor, eventId, { confirmTitle } = {}) {
  await withTransaction(async (client) => {
    const event = await lockManageableEvent(client, actor, eventId);
    const summary = await orders.summarizeEventSales(client, eventId);
    const needsConfirmation = event.status !== EVENT_STATUS.DRAFT || summary.orders > 0;
    if (needsConfirmation && (confirmTitle ?? '').trim() !== event.title.trim()) {
      throw new AppError('DELETE_CONFIRMATION_REQUIRED', undefined, { details: summary });
    }
    await orders.purgeEventSales(client, eventId);
    await schedulesRepository.removeByEvent(client, eventId);
    await eventsRepository.deleteEvent(client, eventId);
    await recordAudit(client, {
      context,
      action: 'EVENT_DELETED',
      entityType: 'event',
      entityId: eventId,
      oldValue: { title: event.title, status: event.status, organizerId: event.organizer_id },
      newValue: summary,
    });
  });
}

/**
 * Move the event through its state machine (see event-status.js).
 *
 * The event row is locked FOR UPDATE before the rules are checked. If two
 * admins approve at the same moment, the second waits for the first to
 * commit, then sees PUBLISHED and gets 409 INVALID_STATE_TRANSITION.
 */
async function changeStatus(context, actor, eventId, { status, reason }) {
  return withTransaction(async (client) => {
    const event = await eventsRepository.findById(client, eventId, { forUpdate: true });
    if (!event || !(canManage(actor, event) || actor.canApprove)) {
      throw eventNotFound();
    }

    const result = findTransition(actor, event, status);
    if (!result.ok) {
      throw new AppError(result.error, result.error === 'INVALID_STATE_TRANSITION'
        ? `Cannot change an event from ${event.status} to ${status}.`
        : undefined);
    }
    const { transition } = result;
    if (transition.reasonRequired && !reason) {
      throw new AppError('REASON_REQUIRED');
    }
    if (transition.requiresUpcomingSchedule && (await schedulesRepository.countUpcoming(client, eventId)) === 0) {
      throw new AppError('EVENT_HAS_NO_SCHEDULES');
    }
    if (transition.requiresSellableConfiguration) {
      await inventoryService.assertSellable(client, eventId);
    }

    await eventsRepository.updateStatus(client, eventId, { from: event.status, to: status });
    let heldOrdersCancelled;
    let paidOrdersRefunded;
    if (status === EVENT_STATUS.CANCELLED) {
      await schedulesRepository.cancelByEvent(client, eventId);
      // Same transaction: either the event is cancelled AND its open orders
      // released AND its paid orders refunded (EVT-08), or nothing happened.
      heldOrdersCancelled = await orders.cancelHeldOrdersOfEvent(client, eventId);
      paidOrdersRefunded = await payments.refundPaidOrdersOfEvent(client, eventId, {
        reason: `Event cancelled: ${reason}`,
        context,
      });
    }
    await recordAudit(client, {
      context,
      action: transition.action,
      entityType: 'event',
      entityId: eventId,
      oldValue: { status: event.status },
      newValue: { status, reason: reason ?? null, heldOrdersCancelled, paidOrdersRefunded },
    });
    if (transition.generatesInventory) {
      // Venues the organizer proposed for this event are approved with it (Phase 12.2).
      await venues.activateVenuesOfEvent(client, eventId, context);
      const created = await inventoryService.generateInventory(client, eventId);
      await recordAudit(client, {
        context,
        action: 'INVENTORY_GENERATED',
        entityType: 'event',
        entityId: eventId,
        newValue: { ...created, trigger: 'approval' },
      });
    }
    return loadDetail(client, eventId);
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Public events come from the cache (10 minutes, refreshed on every change).
 * Anything else (a DRAFT seen by its owner, an admin review) is read fresh.
 */
async function getEvent(actor, idOrSlug) {
  const isId = UUID_PATTERN.test(idOrSlug);
  const lookup = isId ? { id: idOrSlug.toLowerCase() } : { slug: idOrSlug };
  const cached = await remember(NAMESPACE.CATALOG, `event:${lookup.id ?? lookup.slug}`, TTL.EVENT_DETAIL, async () => {
    const row = await eventsRepository.findDetail(pool, lookup);
    if (!row || !PUBLIC_STATUSES.includes(row.status)) return null; // never cache a non-public event
    return toEventDetail(row, await schedulesRepository.listByEvent(pool, row.id));
  });
  if (cached) return cached;

  const row = await eventsRepository.findDetail(pool, lookup);
  if (!row || !canView(actor, row)) {
    throw eventNotFound();
  }
  return toEventDetail(row, await schedulesRepository.listByEvent(pool, row.id));
}

/**
 * Three ways to list:
 *  - public (default): PUBLISHED events with an upcoming schedule, soonest first
 *  - mine=true: the organizer's own events in any status, newest first
 *  - status=X: admins/approvers browse by status (e.g. the approval queue)
 */
async function listEvents(actor, query) {
  const { mine, all, status, q, categoryId, city, dateFrom, dateTo, sort, page, pageSize } = query;
  const hasScheduleFilter = Boolean(city || dateFrom || dateTo);
  let scope;

  if (mine) {
    if (!actor.organizerId) {
      throw new AppError('ORGANIZER_PROFILE_REQUIRED');
    }
    scope = {
      statuses: status ? [status] : Object.values(EVENT_STATUS),
      organizerId: actor.organizerId,
      requireSchedule: hasScheduleFilter,
      defaultSort: '-createdAt',
    };
  } else if (status) {
    if (!(actor.canManageAny || actor.canApprove) && !PUBLIC_STATUSES.includes(status)) {
      throw new AppError('FORBIDDEN', 'Only administrators can list events by this status.');
    }
    scope = { statuses: [status], requireSchedule: hasScheduleFilter, defaultSort: '-createdAt' };
  } else if (all) {
    if (!(actor.canManageAny || actor.canApprove)) {
      throw new AppError('FORBIDDEN', 'Only administrators can list events of every status.');
    }
    scope = { statuses: Object.values(EVENT_STATUS), requireSchedule: hasScheduleFilter, defaultSort: '-createdAt' };
  } else {
    scope = { statuses: [EVENT_STATUS.PUBLISHED], requireSchedule: true, defaultSort: 'startAt', cacheable: true };
  }

  const load = async () => {
    const { rows, total } = await eventsRepository.listEvents(pool, {
      statuses: scope.statuses,
      organizerId: scope.organizerId,
      q,
      categoryId,
      city,
      dateFrom,
      dateTo,
      requireSchedule: scope.requireSchedule,
      sort: sort ?? scope.defaultSort,
      ...toLimitOffset({ page, pageSize }),
    });
    return { events: rows.map(toEventSummary), meta: toPageMeta({ page, pageSize }, total) };
  };

  // Only the public catalogue is cached: "mine" and status filters are per user.
  if (!scope.cacheable) return load();
  const key = keyOf('events', { q, categoryId, city, dateFrom, dateTo, sort, page, pageSize });
  return remember(NAMESPACE.CATALOG, key, TTL.EVENT_LIST, load);
}

const changesCatalog = [NAMESPACE.CATALOG];

module.exports = {
  createEvent,
  updateEvent: invalidatesAfter(changesCatalog, updateEvent),
  deleteEvent: invalidatesAfter(changesCatalog, deleteEvent),
  deletionSummary,
  // Approval may activate proposed venues: venue lists / layouts change too.
  changeStatus: invalidatesAfter([...changesCatalog, NAMESPACE.VENUES], changeStatus),
  getEvent,
  listEvents,
};
