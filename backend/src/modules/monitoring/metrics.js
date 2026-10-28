const os = require('node:os');
const { MONITORING } = require('../../config/constants');
const { redis, tryRedis } = require('../../redis/client');
const { BUCKETS, bucketOf } = require('./histogram');

/**
 * Phase 23: request figures of every API process, added up on Redis.
 *
 * Each process counts in memory and pushes the counts every
 * MONITORING.FLUSH_INTERVAL_MS in one pipeline: one hash per minute,
 * `metrics:m:<minute>`, kept MONITORING.KEEP_MINUTES. Fields:
 *   n               requests
 *   s2 s3 s4 s5     by status class; s429 rate-limited
 *   b0 … b8         latency buckets (histogram.js)
 *   r|<route>|n     requests of one route ("GET /api/v1/events/:id")
 *   r|<route>|b3    its latency buckets
 *   ce              JavaScript errors reported by the web
 * Redis down: the counts of that interval are dropped, requests never wait.
 */
const MINUTE_MS = 60_000;
const minuteOf = (ms) => Math.floor(ms / MINUTE_MS);
const minuteKey = (minute) => `metrics:m:${minute}`;
const WS_KEY = 'monitor:ws';
// One field per API process in the WebSocket counts.
const PROCESS_ID = `${os.hostname()}:${process.pid}`;

let pending = new Map(); // `${minute}\t${field}` → increment

function count(field, by = 1, now = Date.now()) {
  const key = `${minuteOf(now)}\t${field}`;
  pending.set(key, (pending.get(key) ?? 0) + by);
}

/**
 * The route as declared ("GET /api/v1/events/:id"), never the real ids.
 * Unmatched (404): null. `matchedBase` is req.baseUrl when the route matched:
 * Express resets baseUrl once an error leaves the router.
 */
function routeOf(req, matchedBase = req.baseUrl) {
  if (!req.route) return null;
  const path = typeof req.route.path === 'string' ? req.route.path : '';
  return `${req.method} ${matchedBase}${path === '/' ? '' : path}`;
}

/** Remember req.baseUrl at the moment Express sets req.route. */
function trackRouteBase(req) {
  let route;
  let base = '';
  Object.defineProperty(req, 'route', {
    configurable: true,
    enumerable: true,
    get: () => route,
    set(value) {
      route = value;
      base = req.baseUrl;
    },
  });
  return () => base;
}

/** Count every request when its response is sent (/health is left out, as in the log). */
function metricsMiddleware(req, res, next) {
  if (req.originalUrl.startsWith('/health')) return next();
  const started = process.hrtime.bigint();
  const matchedBase = trackRouteBase(req);
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const bucket = bucketOf(ms);
    count('n');
    count(`s${Math.floor(res.statusCode / 100)}`);
    if (res.statusCode === 429) count('s429');
    count(`b${bucket}`);
    const route = routeOf(req, matchedBase());
    if (route) {
      count(`r|${route}|n`);
      count(`r|${route}|b${bucket}`);
    }
  });
  return next();
}

let connectionsSource = () => null;
/** The API process tells how many WebSockets it holds (realtime hub). */
function reportConnections(source) {
  connectionsSource = source;
}

/** Push what was counted since the last flush; also this process's WebSocket count. */
async function flushMetrics(now = Date.now()) {
  const counts = pending;
  pending = new Map();
  await tryRedis('monitoring flush', () => pushCounts(counts, now), null);
}

async function pushCounts(counts, now) {
  const pipeline = redis.pipeline();
  const minutes = new Set();
  for (const [key, by] of counts) {
    const [minute, field] = key.split('\t');
    pipeline.hincrby(minuteKey(minute), field, by);
    minutes.add(minute);
  }
  for (const minute of minutes) pipeline.expire(minuteKey(minute), MONITORING.KEEP_MINUTES * 60);
  const connections = connectionsSource();
  if (connections !== null) pipeline.hset(WS_KEY, PROCESS_ID, JSON.stringify({ connections, at: now }));
  if (pipeline.length === 0) return;
  await pipeline.exec();
}

/**
 * A background job failed for good (its last attempt): counted at once, not
 * batched, since the worker process does not flush. Never throws.
 */
async function recordJobFailure(now = Date.now()) {
  const key = minuteKey(minuteOf(now));
  await tryRedis('monitoring job failure', () => redis.multi().hincrby(key, 'jf', 1).expire(key, MONITORING.KEEP_MINUTES * 60).exec(), null);
}

/** Flush every interval (API process only: tests flush by hand). */
function startMetricsFlush() {
  const timer = setInterval(() => flushMetrics().catch(() => {}), MONITORING.FLUSH_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * The per-minute hashes from `minutes` minutes ago up to the current minute.
 * @returns {Promise<Array<{ minute: number, fields: Record<string, number> }>>}
 */
async function readMinutes(minutes, now = Date.now()) {
  const last = minuteOf(now);
  const wanted = Array.from({ length: minutes }, (_, i) => last - minutes + 1 + i);
  const pipeline = redis.pipeline();
  for (const minute of wanted) pipeline.hgetall(minuteKey(minute));
  const results = await pipeline.exec();
  return wanted.map((minute, i) => {
    const raw = results[i][1] ?? {};
    return { minute, fields: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)])) };
  });
}

/** WebSocket connections of every API process heard from recently. */
async function readConnections(now = Date.now()) {
  const all = await redis.hgetall(WS_KEY);
  let total = 0;
  const stale = [];
  for (const [processId, value] of Object.entries(all)) {
    const { connections, at } = JSON.parse(value);
    if (now - at > MONITORING.WS_REPORT_MAX_AGE_MS) stale.push(processId);
    else total += connections;
  }
  if (stale.length > 0) await redis.hdel(WS_KEY, ...stale);
  return total;
}

/** Latency buckets of a field prefix ("" overall, "r|<route>|" for a route) in one minute's fields. */
function bucketsOf(fields, prefix = '') {
  return Array.from({ length: BUCKETS }, (_, i) => fields[`${prefix}b${i}`] ?? 0);
}

module.exports = {
  metricsMiddleware,
  count,
  recordJobFailure,
  flushMetrics,
  startMetricsFlush,
  reportConnections,
  readMinutes,
  readConnections,
  bucketsOf,
  routeOf,
  minuteOf,
};
