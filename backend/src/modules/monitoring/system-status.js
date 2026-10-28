const fs = require('node:fs/promises');
const env = require('../../config/env');
const { MONITORING } = require('../../config/constants');
const { pool } = require('../../database/pool');
const { redis } = require('../../redis/client');
const { QUEUE, getQueue, queueMode } = require('../../queue/queues');
const { readMinutes, readConnections, bucketsOf } = require('./metrics');
const { emptyBuckets, addBuckets, percentile } = require('./histogram');

/**
 * Phase 23: everything the "Tình trạng hệ thống" page and the alert rules
 * look at, gathered at one moment. Each part is measured on its own: a
 * part that cannot be read (Redis down…) comes back null, never an error.
 */
const HEARTBEAT_KEY = 'monitor:worker:heartbeat';
const PART_TIMEOUT_MS = 2_000;
const MB = 1024 * 1024;
const GB = 1024 * MB;

function withTimeout(promise, ms = PART_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** null when the part could not be read. */
async function part(read) {
  try {
    return await withTimeout(read());
  } catch {
    return null;
  }
}

async function timed(operation) {
  const started = process.hrtime.bigint();
  await withTimeout(operation());
  return Math.round(Number(process.hrtime.bigint() - started) / 1e6);
}

/**
 * Requests of the last `minutes` minutes, from the per-minute counts.
 * @param {Array<{ fields: Record<string, number> }>} rows  readMinutes()
 */
function summarize(rows) {
  const total = { n: 0, s4: 0, s5: 0, s429: 0, ce: 0, jf: 0 };
  const buckets = emptyBuckets();
  const routes = new Map(); // route → { n, buckets }
  for (const { fields } of rows) {
    for (const key of Object.keys(total)) total[key] += fields[key] ?? 0;
    addBuckets(buckets, bucketsOf(fields));
    for (const [field, value] of Object.entries(fields)) {
      const match = /^r\|(.+)\|n$/.exec(field);
      if (!match) continue;
      const route = routes.get(match[1]) ?? { n: 0, buckets: emptyBuckets() };
      route.n += value;
      addBuckets(route.buckets, bucketsOf(fields, `r|${match[1]}|`));
      routes.set(match[1], route);
    }
  }
  return {
    requests: total.n,
    clientErrors4xx: total.s4,
    serverErrors: total.s5,
    rateLimited: total.s429,
    errorRatePercent: total.n > 0 ? Math.round((total.s5 / total.n) * 1000) / 10 : 0,
    p50Ms: percentile(buckets, 50),
    p95Ms: percentile(buckets, 95),
    webErrors: total.ce,
    failedJobs: total.jf,
    routes,
  };
}

/** The 5 slowest routes (by p95) with at least `minRequests` requests. */
function slowestRoutes(routes, minRequests = 5) {
  return [...routes.entries()]
    .filter(([, r]) => r.n >= minRequests)
    .map(([route, r]) => ({ route, requests: r.n, p95Ms: percentile(r.buckets, 95) }))
    .sort((a, b) => b.p95Ms - a.p95Ms || b.requests - a.requests)
    .slice(0, 5);
}

async function database() {
  try {
    const pingMs = await timed(() => pool.query('SELECT 1'));
    return { up: true, pingMs, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } };
  } catch {
    return { up: false, pingMs: null, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } };
  }
}

async function redisStatus() {
  try {
    const pingMs = await timed(() => redis.ping());
    const info = await withTimeout(redis.info('memory'));
    const used = /used_memory:(\d+)/.exec(info);
    return { up: true, pingMs, usedMemoryMb: used ? Math.round(Number(used[1]) / MB) : null };
  } catch {
    return { up: false, pingMs: null, usedMemoryMb: null };
  }
}

/** The worker writes its heartbeat every MONITORING.HEARTBEAT_INTERVAL_MS (src/worker.js). */
async function worker(now) {
  if (queueMode() === 'inline') return { mode: 'inline', alive: true, lastSeenAt: null, ageMs: null };
  const value = await part(() => redis.get(HEARTBEAT_KEY));
  const lastSeen = value ? Number(value) : null;
  const ageMs = lastSeen ? now - lastSeen : null;
  return {
    mode: 'bullmq',
    alive: ageMs !== null && ageMs <= MONITORING.THRESHOLDS.heartbeatMaxAgeMs,
    lastSeenAt: lastSeen ? new Date(lastSeen).toISOString() : null,
    ageMs,
  };
}

async function queues(now) {
  return Promise.all(
    Object.values(QUEUE).map(async (name) => {
      const queue = getQueue(name);
      const counts = await withTimeout(queue.getJobCounts('waiting', 'active', 'delayed', 'failed'));
      const [oldest] = counts.waiting > 0 ? await withTimeout(queue.getJobs(['wait'], 0, 0, true)) : [];
      return { name, ...counts, oldestWaitingMs: oldest ? now - oldest.timestamp : null };
    }),
  );
}

async function business() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM payments WHERE status = 'FAILED' AND created_at > now() - interval '1 hour')::int AS payments_failed,
       (SELECT count(*) FROM refunds WHERE status = 'FAILED')::int AS refunds_failed,
       (SELECT count(*) FROM refunds WHERE status = 'PENDING' AND created_at < now() - make_interval(secs => $1))::int AS refunds_stuck,
       (SELECT count(*) FROM orders WHERE status = 'PAYMENT_PENDING' AND expires_at < now() - interval '5 minutes')::int AS orders_stuck,
       (SELECT coalesce(array_agg(id), '{}') FROM events WHERE queue_enabled) AS queued_events`,
    [MONITORING.THRESHOLDS.refundPendingMs / 1000],
  );
  const row = rows[0];
  let queueWaiting = 0;
  if (row.queued_events.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of row.queued_events) pipeline.zcard(`queue:${id}:waiting`);
    const results = await part(() => pipeline.exec());
    queueWaiting = results ? results.reduce((sum, [, n]) => sum + (Number(n) || 0), 0) : null;
  }
  return {
    paymentsFailedLastHour: row.payments_failed,
    refundsFailed: row.refunds_failed,
    refundsPendingTooLong: row.refunds_stuck,
    ordersStuck: row.orders_stuck,
    purchaseQueueWaiting: queueWaiting,
  };
}

/** Free space where uploaded images are written (on the server: the data disk). */
async function disk() {
  const stats = await fs.statfs(env.UPLOAD_DIR).catch(() => fs.statfs('.'));
  const total = stats.blocks * stats.bsize;
  const free = stats.bavail * stats.bsize;
  return {
    freePercent: total > 0 ? Math.round((free / total) * 1000) / 10 : null,
    freeGb: Math.round((free / GB) * 10) / 10,
    totalGb: Math.round((total / GB) * 10) / 10,
  };
}

/**
 * The whole picture. `minutes`: the window of the request figures
 * (MONITORING.THRESHOLDS.windowMinutes by default).
 */
async function collectStatus({ now = Date.now(), minutes = MONITORING.THRESHOLDS.windowMinutes } = {}) {
  const [db, cache, workerStatus, queueList, businessFigures, diskSpace, recent, hour, webWindow, connections] = await Promise.all([
    database(),
    redisStatus(),
    worker(now),
    part(() => queues(now)),
    part(() => business()),
    part(() => disk()),
    part(() => readMinutes(minutes, now)),
    part(() => readMinutes(60, now)),
    part(() => readMinutes(MONITORING.THRESHOLDS.clientErrorsWindowMinutes, now)),
    part(() => readConnections(now)),
  ]);
  const api = recent ? summarize(recent) : null;
  const lastHour = hour ? summarize(hour) : null;
  const memory = process.memoryUsage();
  return {
    generatedAt: new Date(now).toISOString(),
    api: api && {
      windowMinutes: minutes,
      requests: api.requests,
      requestsPerMinute: Math.round(api.requests / minutes),
      serverErrors: api.serverErrors,
      clientErrors4xx: api.clientErrors4xx,
      rateLimited: api.rateLimited,
      errorRatePercent: api.errorRatePercent,
      p50Ms: api.p50Ms,
      p95Ms: api.p95Ms,
      slowestRoutes: lastHour ? slowestRoutes(lastHour.routes) : [],
    },
    process: { rssMb: Math.round(memory.rss / MB), uptimeSeconds: Math.round(process.uptime()) },
    database: db,
    redis: cache,
    worker: workerStatus,
    queues: queueList,
    failedJobsLastHour: lastHour ? lastHour.failedJobs : null,
    realtime: { connections },
    business: businessFigures,
    disk: diskSpace,
    webErrors: webWindow ? { windowMinutes: MONITORING.THRESHOLDS.clientErrorsWindowMinutes, count: summarize(webWindow).webErrors } : null,
  };
}

/** Requests, server errors and p95 per minute, oldest first (the page's charts). */
async function series(minutes, now = Date.now()) {
  const rows = await readMinutes(minutes, now);
  return rows.map(({ minute, fields }) => ({
    at: new Date(minute * 60_000).toISOString(),
    requests: fields.n ?? 0,
    serverErrors: fields.s5 ?? 0,
    p95Ms: percentile(bucketsOf(fields), 95),
    webErrors: fields.ce ?? 0,
  }));
}

/** Called by the worker: "I am alive". Kept a day, so the page can say when it was last seen. */
async function beat(now = Date.now()) {
  await redis.set(HEARTBEAT_KEY, String(now), 'EX', 24 * 60 * 60);
}

module.exports = { collectStatus, series, beat, summarize, slowestRoutes, HEARTBEAT_KEY };
