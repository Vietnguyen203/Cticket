const { pool } = require('../../database/pool');
const { redis, tryRedis } = require('../../redis/client');
const { EVENT_STATUS, PURCHASE_QUEUE } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const events = require('../events');
const { publish } = require('../../realtime/publisher');
const { MESSAGE, userRoom } = require('../../realtime/messages');
const repository = require('./purchase-queue.repository');

/**
 * Phase 21: the purchase queue ("waiting room") of an event.
 *
 * With the queue on, at most `queue_capacity` people may start an order for
 * the event at the same time (they "have a turn"); the others wait in line
 * and are let in, in order, as turns end: an order paid, cancelled or
 * expired, or a turn that ran out without an order. The queue lives in Redis
 * (Lua scripts in src/redis/scripts.js, each one atomic).
 *
 * The queue only spreads the rush. PostgreSQL still decides every seat, so if
 * Redis is down the queue lets everyone through (logged) rather than stop all
 * sales. See docs/phase-21-queue-design.md.
 */

const STATE = Object.freeze({ NONE: 'NONE', ACTIVE: 'ACTIVE', WAITING: 'WAITING' });

// Bug review BUG-03: the settings are read on every join / place asked / booking,
// up to 1.000 times at once when a sale opens. Kept in memory a few seconds
// (a change on this instance clears them at once; other instances follow
// within SETTINGS_TTL_MS).
const SETTINGS_TTL_MS = 5_000;
const SETTINGS_CACHE_MAX = 10_000;
const settingsCache = new Map(); // "event:id" / "schedule:id" → { at, value: Promise }

function cachedSettings(key, load) {
  const hit = settingsCache.get(key);
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.value;
  if (settingsCache.size >= SETTINGS_CACHE_MAX) settingsCache.clear();
  const value = load().catch((err) => {
    settingsCache.delete(key); // never remember a failure
    throw err;
  });
  settingsCache.set(key, { at: Date.now(), value });
  return value;
}
const eventSettings = (eventId) => cachedSettings(`event:${eventId}`, () => repository.settingsOfEvent(pool, eventId));
const scheduleSettings = (scheduleId) =>
  cachedSettings(`schedule:${scheduleId}`, () => repository.settingsOfSchedule(pool, scheduleId));
/** For tests (a setting changed straight in the database). */
const forgetSettings = () => settingsCache.clear();
const STATES = [STATE.NONE, STATE.ACTIVE, STATE.WAITING];
const MS_PER_MINUTE = 60_000;

const keysOf = (eventId) => [`queue:${eventId}:active`, `queue:${eventId}:waiting`, `queue:${eventId}:seq`];
const isQueued = (settings) => settings?.queue_enabled === true && settings.status === EVENT_STATUS.PUBLISHED;
const argsOf = (settings, userId = '') => [
  userId,
  settings.queue_capacity,
  settings.queue_session_minutes * MS_PER_MINUTE,
  PURCHASE_QUEUE.KEY_TTL_SECONDS,
];

/**
 * Rough wait: the people ahead go in groups of `capacity`, each group taking
 * about half a turn (most people pay well before their turn ends). Shown as
 * "about N minutes", never as a promise.
 */
function estimateWaitSeconds({ place, capacity, sessionMinutes }) {
  if (!place) return 0;
  return Math.ceil(place / capacity) * Math.round((sessionMinutes * 60) / 2);
}

/** Let the people in `admitted` know it is their turn (WebSocket, user room). */
async function tellAdmitted(eventId, admitted, endsAt) {
  for (const userId of admitted) {
    await publish(userRoom(userId), { type: MESSAGE.QUEUE_ADMITTED, eventId, turnEndsAt: endsAt });
  }
}

/** Run a queue script; tell whoever it let in. @returns {{ state, endsAt, place, now }} */
async function runScript(script, settings, userId) {
  const [state, endsMs, place, nowMs, ...admitted] = await redis[script](...keysOf(settings.event_id), ...argsOf(settings, userId));
  if (admitted.length > 0) {
    await tellAdmitted(settings.event_id, admitted, new Date(Number(nowMs) + settings.queue_session_minutes * MS_PER_MINUTE).toISOString());
  }
  return { state: STATES[state], endsAt: endsMs > 0 ? new Date(Number(endsMs)).toISOString() : null, place: Number(place) };
}

function toView(settings, { state, endsAt, place }) {
  const view = { enabled: true, capacity: settings.queue_capacity, sessionMinutes: settings.queue_session_minutes };
  return {
    ...view,
    state,
    turnEndsAt: endsAt,
    place: state === STATE.WAITING ? place : null,
    ahead: state === STATE.WAITING ? place - 1 : null,
    estimatedWaitSeconds:
      state === STATE.WAITING ? estimateWaitSeconds({ place, capacity: view.capacity, sessionMinutes: view.sessionMinutes }) : null,
  };
}

/** No queue (or Redis down): everyone is let through, as before Phase 21. */
const OPEN = Object.freeze({ enabled: false, state: STATE.ACTIVE, turnEndsAt: null, place: null, ahead: null, estimatedWaitSeconds: null });

async function publicSettings(eventId) {
  const settings = await eventSettings(eventId);
  if (!settings || !events.PUBLIC_STATUSES.includes(settings.status)) throw new AppError('NOT_FOUND', 'Event not found.');
  return settings;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/** POST /events/:id/queue: a turn now, or a place in line (joining again keeps the place). */
async function join(userId, eventId) {
  const settings = await publicSettings(eventId);
  if (!isQueued(settings)) return OPEN;
  const at = await tryRedis('purchase queue join', () => runScript('queueJoin', settings, userId), null);
  return at ? toView(settings, at) : OPEN;
}

/** GET /events/:id/queue: where I am (NONE when not in it). */
async function status(userId, eventId) {
  const settings = await publicSettings(eventId);
  if (!isQueued(settings)) return OPEN;
  const at = await tryRedis('purchase queue status', () => runScript('queueStatus', settings, userId), null);
  return at ? toView(settings, at) : OPEN;
}

/**
 * POST /events/:id/queue/try ("Vào ngay"): look at the queue again now
 * instead of waiting for the next check. Room (fewer than N buying) → the line
 * moves on at once, in order: whoever is first gets in, so do I if my place
 * fits in the room. No room → I stay in my place, and am told how full it is.
 * Never a way past the people ahead of me.
 * @returns the usual view, plus `buying` (people buying now, of `capacity`)
 */
async function tryNow(userId, eventId) {
  const settings = await publicSettings(eventId);
  if (!isQueued(settings)) return { ...OPEN, buying: null };
  const result = await tryRedis(
    'purchase queue try',
    async () => {
      // The script lets people in first (expired turns out, then the line in order while there is room).
      let at = await runScript('queueStatus', settings, userId);
      if (at.state === STATE.NONE) at = await runScript('queueJoin', settings, userId);
      const [active] = keysOf(settings.event_id);
      const buying = Number(await redis.zcount(active, `(${Date.now()}`, '+inf'));
      return { at, buying };
    },
    null,
  );
  return result ? { ...toView(settings, result.at), buying: result.buying } : { ...OPEN, buying: null };
}

/** DELETE /events/:id/queue: give up my turn or my place. */
async function leave(userId, eventId) {
  const settings = await publicSettings(eventId);
  if (!isQueued(settings)) return;
  await tryRedis('purchase queue leave', () => runScript('queueLeave', settings, userId), null);
}

// ---------------------------------------------------------------------------
// Booking (orders module)
// ---------------------------------------------------------------------------

/**
 * Before a new order: with the queue on, only people with a turn may book.
 * Not asked of people holding places offered from the waiting list (Phase
 * 18.4): those places are already theirs.
 * @throws QUEUE_TURN_REQUIRED (409)
 */
async function assertTurn(userId, scheduleId) {
  const settings = await scheduleSettings(scheduleId);
  if (!isQueued(settings)) return;
  const [active] = keysOf(settings.event_id);
  const hasTurn = await tryRedis('purchase queue turn', () => redis.queueHasTurn(active, userId), 1);
  if (hasTurn === 1) return;
  if (await repository.hasWaitlistOffer(pool, { userId, scheduleId })) return;
  throw new AppError('QUEUE_TURN_REQUIRED', undefined, { details: { eventId: settings.event_id } });
}

/** After an order is made / checked out: the turn lasts until that order's deadline. */
async function extendTurn(userId, eventId, untilIso) {
  if (!untilIso) return;
  const [active] = keysOf(eventId);
  await tryRedis('purchase queue extend', () => redis.queueExtend(active, userId, new Date(untilIso).getTime()), 0);
}

/**
 * Bug review BUG-02: a VNPay payment can outlive its order's deadline (the
 * order stays open until VNPay is asked). The turn lasts as long, so nobody
 * else is let in while this buyer may still be paying.
 */
async function extendTurnOfSchedule(userId, scheduleId, untilIso) {
  const settings = await scheduleSettings(scheduleId);
  if (isQueued(settings)) await extendTurn(userId, settings.event_id, untilIso);
}

/**
 * An order ended (paid, cancelled, expired): once that commits, its owner's
 * turn ends too, unless they still have another open order for the event,
 * and the next people in line are let in.
 * @param {{ afterCommit?: Function }} db  the transaction (or the pool: run now)
 */
function releaseTurnAfterCommit(db, { userId, scheduleId }) {
  const release = async () => {
    const settings = await scheduleSettings(scheduleId);
    if (!isQueued(settings)) return;
    if (await repository.hasOpenOrderInEvent(pool, { userId, eventId: settings.event_id })) return;
    await tryRedis('purchase queue release', () => runScript('queueLeave', settings, userId), null);
  };
  if (typeof db.afterCommit === 'function') db.afterCommit(release);
  else release().catch((err) => logger.error({ err }, 'Purchase queue release failed'));
}

// ---------------------------------------------------------------------------
// Organizers, admins, the worker
// ---------------------------------------------------------------------------

/** GET /events/:id/queue/stats: people buying / waiting now (the event's organizer, admins). */
async function stats(user, eventId) {
  const actor = await events.resolveActor(user);
  const settings = await repository.settingsOfEvent(pool, eventId);
  if (!settings || !events.canManage(actor, settings)) throw new AppError('NOT_FOUND', 'Event not found.');
  const base = { enabled: settings.queue_enabled, capacity: settings.queue_capacity, sessionMinutes: settings.queue_session_minutes };
  const [active, waiting] = keysOf(eventId);
  const counts = await tryRedis(
    'purchase queue stats',
    () => redis.multi().zcount(active, `(${Date.now()}`, '+inf').zcard(waiting).exec(),
    null,
  );
  if (!counts) return { ...base, active: null, waiting: null };
  return { ...base, active: Number(counts[0][1]), waiting: Number(counts[1][1]) };
}

/**
 * The event's queue settings changed (events module, after commit): switched
 * off → the queue is dropped (everyone may book); otherwise more room may let
 * people in at once.
 */
async function settingsChanged(eventId) {
  forgetSettings();
  const settings = await repository.settingsOfEvent(pool, eventId);
  if (!settings) return;
  if (!isQueued(settings)) {
    await tryRedis('purchase queue drop', () => redis.del(...keysOf(eventId)), 0);
    return;
  }
  await tryRedis('purchase queue admit', () => runScript('queueStatus', settings, ''), null);
}

/**
 * Maintenance job `admit-queues` (every few seconds): turns that ran out
 * without an order end here, and the next people are let in. The releases
 * after commit do this at once; this catches what they missed.
 * @returns {Promise<number>} queues looked at
 */
async function admitQueues() {
  const queued = await repository.queuedEvents(pool);
  for (const settings of queued) {
    await tryRedis('purchase queue admit', () => runScript('queueStatus', settings, ''), null);
  }
  return queued.length;
}

module.exports = {
  STATE,
  estimateWaitSeconds,
  join,
  status,
  tryNow,
  leave,
  assertTurn,
  extendTurn,
  extendTurnOfSchedule,
  releaseTurnAfterCommit,
  forgetSettings,
  stats,
  settingsChanged,
  admitQueues,
};
