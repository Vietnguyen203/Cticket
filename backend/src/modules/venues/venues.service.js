const { pool } = require('../../database/pool');
const { VENUE_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { toLimitOffset, toPageMeta } = require('../../utils/pagination');
const { invalidatesAfter, NAMESPACE } = require('../../redis/cache');
const venuesRepository = require('./venues.repository');

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Public callers see ACTIVE venues only; managers may include inactive ones. */
async function listVenues({ q, city, includeInactive, page, pageSize }, { canManage }) {
  const { rows, total } = await venuesRepository.list(pool, {
    q,
    city,
    includeInactive: Boolean(includeInactive && canManage),
    ...toLimitOffset({ page, pageSize }),
  });
  return { venues: rows.map(toPublicVenue), meta: toPageMeta({ page, pageSize }, total) };
}

async function getVenue(id, { canManage }) {
  const row = await venuesRepository.findById(pool, id);
  if (!row || (row.status !== VENUE_STATUS.ACTIVE && !canManage)) {
    throw new AppError('NOT_FOUND', 'Venue not found.');
  }
  return toPublicVenue(row);
}

async function createVenue(body) {
  return toPublicVenue(await venuesRepository.insert(pool, body));
}

/**
 * Venues are never deleted (schedules reference them); set status INACTIVE
 * instead, which hides the venue and stops new schedules from using it.
 */
async function updateVenue(id, changes) {
  const row = await venuesRepository.update(pool, id, changes);
  if (!row) {
    throw new AppError('NOT_FOUND', 'Venue not found.');
  }
  return toPublicVenue(row);
}

/** For other modules: is this venue usable for a new schedule? (inside their transaction) */
async function findActiveVenue(db, id) {
  const row = await venuesRepository.findById(db, id);
  return row && row.status === VENUE_STATUS.ACTIVE ? row : null;
}

module.exports = {
  listVenues,
  getVenue,
  createVenue,
  // The venue name is shown on event pages and in its cached layout.
  updateVenue: invalidatesAfter([NAMESPACE.VENUES, NAMESPACE.CATALOG], updateVenue),
  findActiveVenue,
};
