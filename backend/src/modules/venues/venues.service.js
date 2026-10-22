const { pool } = require('../../database/pool');
const { recordAudit } = require('../audit');
const { VENUE_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { toLimitOffset, toPageMeta } = require('../../utils/pagination');
const { invalidatesAfter, NAMESPACE } = require('../../redis/cache');
const venuesRepository = require('./venues.repository');
const layoutRepository = require('./venue-layout.repository');

// NUMERIC columns arrive as strings. Coordinates are not money, so a JS
// number is fine here (unlike prices, which stay integers).
const toNumberOrNull = (value) => (value === null ? null : Number(value));

function toPublicVenue(row) {
  return {
    id: row.id,
    name: row.name,
    addressLine: row.address_line,
    city: row.city,
    province: row.province,
    country: row.country,
    latitude: toNumberOrNull(row.latitude),
    longitude: toNumberOrNull(row.longitude),
    capacity: row.capacity,
    status: row.status,
    createdByOrganizerId: row.created_by_organizer_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Who may see a venue that is not ACTIVE: venue managers (admins), and the
 * organizer who proposed a PENDING one.
 * @param {{ canManage: boolean, organizerId: string|null }} viewer
 */
function canSee(row, viewer) {
  if (row.status === VENUE_STATUS.ACTIVE || viewer.canManage) return true;
  return row.status === VENUE_STATUS.PENDING && viewer.organizerId !== null && row.created_by_organizer_id === viewer.organizerId;
}

/** Public callers see ACTIVE venues; an organizer also their PENDING proposals; managers any status. */
async function listVenues({ q, city, includeInactive, status, page, pageSize }, viewer) {
  const { rows, total } = await venuesRepository.list(pool, {
    q,
    city,
    includeAll: Boolean(includeInactive && viewer.canManage),
    status: viewer.canManage ? status : undefined,
    organizerId: viewer.organizerId,
    ...toLimitOffset({ page, pageSize }),
  });
  return { venues: rows.map(toPublicVenue), meta: toPageMeta({ page, pageSize }, total) };
}

async function getVenue(id, viewer) {
  const row = await venuesRepository.findById(pool, id);
  if (!row || !canSee(row, viewer)) {
    throw new AppError('NOT_FOUND', 'Venue not found.');
  }
  return toPublicVenue(row);
}

/**
 * A venue manager creates an ACTIVE venue. An organizer (venue:propose)
 * creates a PENDING one: usable by their own DRAFT events, approved with the
 * event (or on its own by an admin).
 */
async function createVenue(body, viewer) {
  if (viewer.canManage) {
    return toPublicVenue(await venuesRepository.insert(pool, { ...body, status: VENUE_STATUS.ACTIVE }));
  }
  if (!viewer.organizerId) throw new AppError('ORGANIZER_PROFILE_REQUIRED');
  return toPublicVenue(
    await venuesRepository.insert(pool, { ...body, status: VENUE_STATUS.PENDING, createdByOrganizerId: viewer.organizerId }),
  );
}

/**
 * Venues are never deleted (schedules reference them); set status INACTIVE
 * instead, which hides the venue and stops new schedules from using it.
 */
async function updateVenue(id, changes) {
  if (changes.capacity) {
    // The capacity cannot go below what the zones already hold.
    const used = await layoutRepository.countPlaces(pool, id);
    if (used > changes.capacity) {
      throw new AppError('VENUE_CAPACITY_EXCEEDED', undefined, {
        details: [{ field: 'body.capacity', message: `the zones already hold ${used}`, capacity: changes.capacity, used, adding: 0 }],
      });
    }
  }
  const row = await venuesRepository.update(pool, id, changes);
  if (!row) {
    throw new AppError('NOT_FOUND', 'Venue not found.');
  }
  return toPublicVenue(row);
}

/**
 * For other modules: may a schedule of this organizer's event use the venue?
 * ACTIVE venues, or a PENDING venue that this organizer proposed.
 */
async function findUsableVenue(db, id, organizerId) {
  const row = await venuesRepository.findById(db, id);
  if (!row) return null;
  if (row.status === VENUE_STATUS.ACTIVE) return row;
  return row.status === VENUE_STATUS.PENDING && row.created_by_organizer_id === organizerId ? row : null;
}

/**
 * Approval of an event (its transaction): the PENDING venues of its schedules
 * become ACTIVE. A venue an admin rejected (INACTIVE) blocks the approval.
 * @returns {Promise<string[]>} ids of the venues activated
 */
async function activateVenuesOfEvent(client, eventId, context) {
  const venues = await venuesRepository.lockVenuesOfEvent(client, eventId);
  if (venues.some((venue) => venue.status === VENUE_STATUS.INACTIVE)) {
    throw new AppError('VENUE_NOT_AVAILABLE', 'A venue of this event was rejected or deactivated: change the venue first.');
  }
  const pending = venues.filter((venue) => venue.status === VENUE_STATUS.PENDING).map((venue) => venue.id);
  if (pending.length === 0) return [];
  await venuesRepository.activate(client, pending);
  for (const venueId of pending) {
    await recordAudit(client, {
      context,
      action: 'VENUE_APPROVED',
      entityType: 'venue',
      entityId: venueId,
      oldValue: { status: VENUE_STATUS.PENDING },
      newValue: { status: VENUE_STATUS.ACTIVE, trigger: 'event approval', eventId },
    });
  }
  return pending;
}

module.exports = {
  listVenues,
  getVenue,
  createVenue,
  // The venue name is shown on event pages and in its cached layout.
  updateVenue: invalidatesAfter([NAMESPACE.VENUES, NAMESPACE.CATALOG], updateVenue),
  findUsableVenue,
  activateVenuesOfEvent,
  canSee,
};
