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
const SEAT_HINT_TTL_SECONDS = 3;
const TAKEN_SEAT_STATUSES = new Set(['HELD', 'SOLD', 'BLOCKED']);

const seatLockKey = (scheduleId, seatId) => `seatlock:${scheduleId}:${seatId}`;
const seatTakenKey = (scheduleId, seatId) => `seat-taken:${scheduleId}:${seatId}`;
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

/**
 * "Seat taken" hint (Phase 13 load test): in an on-sale rush most requests
 * target seats that are already held. Without the hint each of them still
 * opens a transaction and locks the seat row just to answer 409, and a
 * cancel / payment of that seat queues behind them. After PostgreSQL refused
 * a seat, the same answer comes from Redis for a few seconds. When the seat
 * comes back on sale (cancel, expiry, refund) the hint is deleted after the
 * commit; if that delete fails, the hint is wrong for SEAT_HINT_TTL_SECONDS
 * at most (an unblocked seat too: unblocking is rare and does not delete it).
 */
async function assertSeatHints(scheduleId, seatIds) {
  if (seatIds.length === 0) return;
  const hints = await tryRedis('seat hint', () => redis.mget(...seatIds.map((seatId) => seatTakenKey(scheduleId, seatId))), []);
  const taken = seatIds.flatMap((seatId, index) => (hints[index] ? [{ seatId, status: hints[index] }] : []));
  if (taken.length > 0) throw new AppError('SEATS_UNAVAILABLE', undefined, { details: taken });
}

/** @param {Array<{ seatId: string, status: string }>} refused  details of a SEATS_UNAVAILABLE from PostgreSQL */
async function rememberTakenSeats(scheduleId, refused) {
  const taken = refused.filter((seat) => TAKEN_SEAT_STATUSES.has(seat.status));
  if (taken.length === 0) return;
  await tryRedis(
    'seat hint write',
    () => {
      const batch = redis.multi();
      for (const seat of taken) batch.set(seatTakenKey(scheduleId, seat.seatId), seat.status, 'EX', SEAT_HINT_TTL_SECONDS);
      return batch.exec();
    },
    null,
  );
}

async function forgetTakenSeats(scheduleId, seatIds) {
  if (seatIds.length === 0) return;
  await tryRedis('seat hint clear', () => redis.del(...seatIds.map((seatId) => seatTakenKey(scheduleId, seatId))), 0);
}

/** Seats back on sale in this transaction: drop their hints once it commits (never inside it). */
function forgetTakenSeatsAfterCommit(client, scheduleId, seatIds) {
  if (seatIds.length > 0 && typeof client.afterCommit === 'function') {
    client.afterCommit(() => forgetTakenSeats(scheduleId, seatIds));
  }
}

module.exports = {
  lockSeats,
  assertGaHint,
  rememberGaLeft,
  assertSeatHints,
  rememberTakenSeats,
  forgetTakenSeats,
  forgetTakenSeatsAfterCommit,
  SEAT_LOCK_TTL_MS,
  SEAT_HINT_TTL_SECONDS,
};
