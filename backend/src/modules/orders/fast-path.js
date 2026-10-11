const { randomUUID } = require('node:crypto');
const AppError = require('../../utils/AppError');
const { redis, tryRedis } = require('../../redis/client');

/**
 * Redis "fast path" in front of the PostgreSQL booking transaction.
 *
 * It only REJECTS early; it never accepts on its own. PostgreSQL (row locks,
 * conditional updates, constraints) still decides every booking, so if Redis
 * is down or loses its data the booking flow is exactly the Phase 5 one.
 *
 * Why: when thousands of requests hit one seat, each of them would otherwise
 * hold a PostgreSQL connection while queueing for the row lock, starving
 * requests for OTHER seats. A Redis rejection costs ~1 ms and no connection.
 */
const SEAT_LOCK_TTL_MS = 5_000; // covers the booking transaction, never the whole 10-minute hold
const GA_HINT_TTL_SECONDS = 3;

const seatLockKey = (scheduleId, seatId) => `seatlock:${scheduleId}:${seatId}`;
const gaLeftKey = (ticketTypeId) => `ga-left:${ticketTypeId}`;
const NOOP_RELEASE = async () => {};

/**
 * Lock all requested seats ("someone is booking these right now") or none.
 * @returns {Promise<() => Promise<void>>} release function: deletes only the
 *   locks this request still owns
 * @throws SEATS_UNAVAILABLE with status LOCKED when another request holds one
 */
async function lockSeats(scheduleId, seatIds) {
  if (seatIds.length === 0) return NOOP_RELEASE;
  const sorted = [...seatIds].sort();
  const keys = sorted.map((seatId) => seatLockKey(scheduleId, seatId));
  const owner = randomUUID();

  const blockedIndex = await tryRedis('seat lock', () => redis.seatLock(keys.length, ...keys, owner, SEAT_LOCK_TTL_MS), 0);
  if (blockedIndex > 0) {
    throw new AppError('SEATS_UNAVAILABLE', 'Someone is booking this seat right now. Try again in a few seconds.', {
      details: [{ seatId: sorted[blockedIndex - 1], status: 'LOCKED' }],
    });
  }
  return async () => {
    await tryRedis('seat unlock', () => redis.seatUnlock(keys.length, ...keys, owner), 0);
  };
}

/**
 * "Sold out" hint for general admission: after PostgreSQL reported that only
 * N tickets are left, requests for more than N are refused for a few seconds
 * without a transaction. The hint expires quickly instead of being deleted
 * when tickets come back, so it can only be wrong for GA_HINT_TTL_SECONDS.
 */
async function assertGaHint(items) {
  if (items.length === 0) return;
  const left = await tryRedis('ga hint', () => redis.mget(...items.map((item) => gaLeftKey(item.ticketTypeId))), []);
  const short = items.filter((item, index) => left[index] != null && item.quantity > Number(left[index]));
  if (short.length > 0) {
    throw new AppError('INSUFFICIENT_INVENTORY', 'Not enough tickets are left.', {
      details: short.map((item) => ({ field: 'body.items', message: `${item.ticketTypeId} has fewer than ${item.quantity} left` })),
    });
  }
}

async function rememberGaLeft(ticketTypeId, left) {
  await tryRedis('ga hint write', () => redis.set(gaLeftKey(ticketTypeId), String(left), 'EX', GA_HINT_TTL_SECONDS), null);
}

module.exports = { lockSeats, assertGaHint, rememberGaLeft, SEAT_LOCK_TTL_MS };
