const Redis = require('ioredis');
const env = require('../config/env');
const logger = require('../utils/logger');
const { SCRIPTS } = require('./scripts');

// Every key gets this prefix (ioredis adds it, also to the KEYS of Lua
// scripts), so one Redis can be shared with other apps without collisions.
const KEY_PREFIX = 'etp:';
const ERROR_LOG_INTERVAL_MS = 30_000;

/**
 * One shared connection for the whole process.
 *
 * - lazyConnect: scripts that never touch Redis (seed:admin, migrations) do
 *   not open a connection and can exit normally.
 * - commandTimeout: a slow or unreachable Redis fails a command after
 *   REDIS_COMMAND_TIMEOUT_MS instead of stalling the request.
 * - maxRetriesPerRequest: 1, so commands do not pile up while reconnecting.
 */
const redis = new Redis(env.REDIS_URL, {
  keyPrefix: KEY_PREFIX,
  lazyConnect: true,
  commandTimeout: env.REDIS_COMMAND_TIMEOUT_MS,
  connectTimeout: 2_000,
  maxRetriesPerRequest: 1,
});

for (const [name, definition] of Object.entries(SCRIPTS)) {
  redis.defineCommand(name, definition);
}

// Without a listener, ioredis prints every reconnect error. Log at most one
// warning per interval: the callers already degrade gracefully (see tryRedis).
let lastErrorLoggedAt = 0;
redis.on('error', (err) => {
  if (Date.now() - lastErrorLoggedAt > ERROR_LOG_INTERVAL_MS) {
    lastErrorLoggedAt = Date.now();
    logger.warn({ err }, 'Redis connection error');
  }
});

/**
 * Run a Redis operation that the request can live without (cache, rate
 * limit, seat lock, denylist check). On any Redis error: log and return
 * `fallback`, so the request continues against PostgreSQL alone.
 * @template T
 * @param {string} what  short label for the log
 * @param {() => Promise<T>} operation
 * @param {T} fallback
 */
async function tryRedis(what, operation, fallback) {
  try {
    return await operation();
  } catch (err) {
    logger.warn({ err, what }, 'Redis unavailable; continuing without it');
    return fallback;
  }
}

async function checkRedis() {
  return (await redis.ping()) === 'PONG';
}

async function closeRedis() {
  if (redis.status === 'wait' || redis.status === 'end') {
    redis.disconnect(); // never connected (lazyConnect) or already closed
    return;
  }
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}

module.exports = { redis, tryRedis, checkRedis, closeRedis, KEY_PREFIX };
