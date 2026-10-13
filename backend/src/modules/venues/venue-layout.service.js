const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { PG_ERROR } = require('../../database/errors');
const { ZONE_KIND, VENUE_STATUS, INVENTORY_LIMITS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const venuesRepository = require('./venues.repository');
const layoutRepository = require('./venue-layout.repository');
const { canSee } = require('./venues.service');
const { remember, invalidatesAfter, NAMESPACE, TTL } = require('../../redis/cache');

const SEAT_NUMBER_DIGITS = 2;

const toNumberOrNull = (value) => (value === null ? null : Number(value));

function toPublicZone(row) {
  return {
    id: row.id,
    venueId: row.venue_id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    capacity: row.capacity,
  };
}

function toPublicSeat(row) {
  return {
    id: row.id,
    zoneId: row.venue_zone_id,
    code: row.seat_code,
    rowLabel: row.row_label,
    seatNumber: row.seat_number,
    seatType: row.seat_type,
    x: toNumberOrNull(row.x),
    y: toNumberOrNull(row.y),
  };
}

/**
 * Who may add zones / seats: venue managers, or the organizer who proposed
 * the venue while it is still PENDING (once approved it is shared, so only
 * admins change it).
 * @param {{ canManage: boolean, organizerId: string|null }} viewer
 */
function assertCanBuild(venue, viewer) {
  if (!venue || !canSee(venue, viewer)) throw new AppError('NOT_FOUND', 'Venue not found.');
  if (viewer.canManage) return;
  if (venue.status !== VENUE_STATUS.PENDING) {
    throw new AppError('FORBIDDEN', 'This venue is approved: only an administrator can change it.');
  }
}

async function createZone(venueId, body, viewer) {
  const venue = await venuesRepository.findById(pool, venueId);
  assertCanBuild(venue, viewer);
  // A duplicate code is rejected by UNIQUE(venue_id, code) → 409 ZONE_CODE_TAKEN.
  return toPublicZone(await layoutRepository.insertZone(pool, { venueId, ...body }));
}

async function updateZone(zoneId, changes) {
  const zone = await layoutRepository.findZoneById(pool, zoneId);
  if (!zone) {
    throw new AppError('NOT_FOUND', 'Zone not found.');
  }
  if (zone.kind === ZONE_KIND.STANDING && changes.capacity === null) {
    throw new AppError('VALIDATION_ERROR', undefined, {
      details: [{ field: 'body.capacity', message: 'a STANDING zone needs a capacity' }],
    });
  }
  return toPublicZone(await layoutRepository.updateZone(pool, zoneId, changes));
}

/**
 * Expand row specs ({ rowLabel: 'A', from: 1, to: 20 }) into seats with
 * codes ("A01") and seat-map coordinates: one row per line, seats spaced
 * evenly along it.
 */
function buildSeats(rows, { originX = 0, originY = 0, spacing = INVENTORY_LIMITS.SEAT_SPACING } = {}) {
  return rows.flatMap((row, rowIndex) =>
    Array.from({ length: row.to - row.from + 1 }, (_, offset) => {
      const seatNumber = row.from + offset;
      return {
        rowLabel: row.rowLabel,
        seatNumber,
        seatCode: `${row.rowLabel}${String(seatNumber).padStart(SEAT_NUMBER_DIGITS, '0')}`,
        seatType: row.seatType,
        x: originX + offset * spacing,
        y: originY + rowIndex * spacing,
      };
    }),
  );
}

/**
 * Bulk-create seats in a SEATED zone (≤ 2,000 per request, one INSERT).
 * The zone row is locked so its kind cannot change while seats are added.
 */
async function createSeats(zoneId, { rows, layout }, viewer) {
  return withTransaction(async (client) => {
    const zone = await layoutRepository.findZoneById(client, zoneId, { forUpdate: true });
    if (!zone) {
      throw new AppError('NOT_FOUND', 'Zone not found.');
    }
    assertCanBuild(await venuesRepository.findById(client, zone.venue_id), viewer);
    if (zone.kind !== ZONE_KIND.SEATED) {
      throw new AppError('ZONE_NOT_SEATED');
    }
    const seats = buildSeats(rows, layout);
    const created = await layoutRepository.insertSeats(client, zoneId, seats);
    return { zoneId, created };
  });
}

/**
 * A seat that appears in any seat plan or schedule inventory cannot be
 * deleted: the foreign keys (RESTRICT) make PostgreSQL refuse it, which is
 * race-free unlike checking usage first.
 */
async function deleteSeat(seatId) {
  let deleted;
  try {
    deleted = await layoutRepository.deleteSeat(pool, seatId);
  } catch (err) {
    if (err.code === PG_ERROR.FOREIGN_KEY_VIOLATION) {
      throw new AppError('SEAT_IN_USE', undefined, { cause: err });
    }
    throw err;
  }
  if (!deleted) {
    throw new AppError('NOT_FOUND', 'Seat not found.');
  }
}

/** Physical layout: zones with their seats and coordinates (for drawing a seat map). */
async function getLayout(venueId, viewer) {
  // An ACTIVE venue's layout comes from the cache (1 hour, refreshed on change).
  const cached = await remember(NAMESPACE.VENUES, `layout:${venueId}`, TTL.VENUE_LAYOUT, () => loadLayout(venueId, null));
  if (cached) return cached;

  const layout = await loadLayout(venueId, viewer);
  if (!layout) {
    throw new AppError('NOT_FOUND', 'Venue not found.');
  }
  return layout;
}

/** viewer null: public (ACTIVE only, the cacheable case). */
async function loadLayout(venueId, viewer) {
  const venue = await venuesRepository.findById(pool, venueId);
  const visible = venue && (viewer ? canSee(venue, viewer) : venue.status === VENUE_STATUS.ACTIVE);
  if (!visible) {
    return null;
  }
  const [zones, seats] = await Promise.all([
    layoutRepository.listZones(pool, venueId),
    layoutRepository.listSeats(pool, venueId),
  ]);
  return {
    venue: { id: venue.id, name: venue.name },
    zones: zones.map((zone) => ({
      ...toPublicZone(zone),
      seats: seats.filter((seat) => seat.venue_zone_id === zone.id).map(toPublicSeat),
    })),
  };
}

// For other modules (inside their transactions) --------------------------------

async function findZone(db, zoneId) {
  return layoutRepository.findZoneById(db, zoneId);
}

async function findPlannableSeats(db, query) {
  return layoutRepository.findPlannableSeats(db, query);
}

// Zone names and seats also appear in the cached seat maps of schedules.
const changesLayout = [NAMESPACE.VENUES, NAMESPACE.CATALOG];

module.exports = {
  createZone: invalidatesAfter(changesLayout, createZone),
  updateZone: invalidatesAfter(changesLayout, updateZone),
  createSeats: invalidatesAfter(changesLayout, createSeats),
  deleteSeat: invalidatesAfter(changesLayout, deleteSeat),
  getLayout,
  findZone,
  findPlannableSeats,
  toPublicSeat,
};
