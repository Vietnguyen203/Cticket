const { redis, tryRedis } = require('./client');

/**
 * Cache-aside with versioned namespaces.
 *
 * A cached value lives at  cache:{namespace}:v{N}:{key}  where N is the
 * namespace's current version. A write (after COMMIT) bumps N, so every key
 * of the namespace is invalidated at once without searching for them (an
 * event list has endless filter combinations); old keys are simply never
 * read again and expire on their own.
 *
 * If a reader loaded data just before a write and stores it after the bump,
 * it lands under the OLD version, where nobody looks: no stale data is served.
 */
const NAMESPACE = Object.freeze({
  CATALOG: 'catalog', // events, schedules, ticket types and seat maps as shown to customers
  CATEGORIES: 'categories',
  VENUES: 'venues', // venue layouts (zones, seats); changed rarely, by admins only
});

const versionKey = (namespace) => `cache:ver:${namespace}`;

// Single flight: while one request loads a key, others in this process wait
// for that result instead of all querying PostgreSQL at the same moment.
const inFlight = new Map();

// Process memory for a few large, read-mostly values (option `local`): the
// layout of a 2.000-seat map is ~0.5 MB of JSON that every seat page would
// otherwise fetch from Redis and parse again (Phase 14.2). The versioned key
// keeps it right: an invalidation bumps the version (read from Redis on every
// call, so all API instances see it), the key changes, the old entry is never
// read again. Values are SHARED between requests: callers must not mutate them.
const LOCAL_MAX_ENTRIES = 50;
const local = new Map(); // fullKey -> { value, expiresAt }

function readLocal(fullKey) {
  const entry = local.get(fullKey);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    local.delete(fullKey);
    return undefined;
  }
  return entry.value;
}

function writeLocal(fullKey, value, ttlSeconds) {
  if (value === null) return;
  local.delete(fullKey); // re-insert: Map order = age, the oldest goes first
  local.set(fullKey, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  if (local.size > LOCAL_MAX_ENTRIES) local.delete(local.keys().next().value);
}

/**
 * @template T
 * @param {string} namespace
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {() => Promise<T|null>} loader  null / undefined results are not cached
 * @param {{ local?: boolean }} [options]  local: also keep the parsed value in this process
 * @returns {Promise<T|null>}  always JSON-shaped (dates as ISO strings), cached or not
 */
async function remember(namespace, key, ttlSeconds, loader, { local: keepLocal = false } = {}) {
  const toJson = (value) => (value === null || value === undefined ? null : JSON.parse(JSON.stringify(value)));

  const version = await tryRedis('cache version', () => redis.get(versionKey(namespace)), undefined);
  if (version === undefined) {
    return toJson(await loader()); // Redis down: no cache, straight to PostgreSQL
  }
  const fullKey = `cache:${namespace}:v${version ?? 0}:${key}`;
  if (keepLocal) {
    const kept = readLocal(fullKey);
    if (kept !== undefined) return kept;
  }

  const hit = await tryRedis('cache read', () => redis.get(fullKey), null);
  if (hit !== null) {
    const value = JSON.parse(hit);
    if (keepLocal) writeLocal(fullKey, value, ttlSeconds);
    return value;
  }

  if (!inFlight.has(fullKey)) {
    const load = (async () => {
      const value = toJson(await loader());
      if (value !== null) {
        await tryRedis('cache write', () => redis.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds), null);
        if (keepLocal) writeLocal(fullKey, value, ttlSeconds);
      }
      return value;
    })().finally(() => inFlight.delete(fullKey));
    inFlight.set(fullKey, load);
  }
  return inFlight.get(fullKey);
}

/**
 * Call AFTER the transaction committed. If Redis is down the bump is lost and
 * readers may see the old data until its TTL ends; acceptable because every
 * purchase re-checks PostgreSQL.
 */
async function invalidate(...namespaces) {
  await tryRedis(
    'cache invalidate',
    () => namespaces.reduce((multi, namespace) => multi.incr(versionKey(namespace)), redis.multi()).exec(),
    null,
  );
}

/**
 * Wrap a service function that writes: once it has returned (its transaction
 * committed), bump the given namespaces. A function that throws invalidates
 * nothing, since nothing changed.
 */
function invalidatesAfter(namespaces, fn) {
  return async function invalidatingWrite(...args) {
    const result = await fn(...args);
    await invalidate(...namespaces);
    return result;
  };
}

/** Stable key for a query object: same filters in any order → same key. */
function keyOf(prefix, params) {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value instanceof Date ? value.toISOString() : value}`);
  return `${prefix}:${entries.join('&')}`;
}

/** Cache times, from the requirements sheet (CAT-01, EVT-02, VEN-01). */
const TTL = Object.freeze({
  CATEGORIES: 3600,
  EVENT_LIST: 60,
  EVENT_DETAIL: 600,
  SCHEDULES: 600,
  VENUE_LAYOUT: 3600,
  SEAT_MAP_LAYOUT: 3600,
});

/** For tests: forget what this process keeps in memory. */
function clearLocalCache() {
  local.clear();
}

module.exports = { clearLocalCache, remember, invalidate, invalidatesAfter, keyOf, NAMESPACE, TTL };
