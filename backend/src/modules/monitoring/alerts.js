const env = require('../../config/env');
const { MONITORING } = require('../../config/constants');
const { pool } = require('../../database/pool');
const { redis } = require('../../redis/client');
const logger = require('../../utils/logger');
const mailer = require('../../mail/mailer');
const { systemAlertEmail } = require('../../mail/templates');
const { collectStatus } = require('./system-status');

/**
 * Phase 23: alert rules, checked every minute in an API process (not in the
 * worker: "the worker is down" is the first thing to report). Emails go
 * straight over SMTP, not through the email queue, which needs the worker.
 *
 * An alert starts after `consecutive` checks in a row see the problem, is
 * emailed again after MONITORING.REMIND_AFTER_MS while it lasts, and once
 * more when it is over. State and history live on Redis (shared by every API
 * process); with Redis down they are kept in this process's memory.
 */
const T = MONITORING.THRESHOLDS;
const STATE_KEY = 'monitor:alerts:state';
const HISTORY_KEY = 'monitor:alerts:history';
const LOCK_KEY = 'monitor:alerts:lock';
const KEEP_MS = MONITORING.HISTORY_DAYS * 24 * 60 * 60 * 1000;

const seconds = (ms) => Math.round(ms / 1000);
const minutes = (ms) => Math.round(ms / 60_000);

/** Each rule returns what is wrong (shown in the email and on the page), or null. */
const RULES = [
  {
    key: 'api-errors',
    title: 'Tỉ lệ lỗi máy chủ (5xx) cao',
    check: ({ api }) =>
      api && api.requests >= T.errorRateMinRequests && api.errorRatePercent > T.errorRatePercent
        ? `${api.errorRatePercent}% request lỗi 5xx trong ${api.windowMinutes} phút (${api.serverErrors} / ${api.requests})`
        : null,
  },
  {
    key: 'api-slow',
    title: 'API chậm',
    check: ({ api }) =>
      api && api.requests > 0 && api.p95Ms > T.p95Ms ? `p95 ${api.p95Ms} ms trong ${api.windowMinutes} phút (ngưỡng ${T.p95Ms} ms)` : null,
  },
  {
    key: 'database-down',
    title: 'Cơ sở dữ liệu không trả lời',
    consecutive: T.dependencyFailures,
    check: ({ database }) => (database.up ? null : 'PostgreSQL không trả lời lệnh kiểm tra'),
  },
  {
    key: 'redis-down',
    title: 'Redis không trả lời',
    consecutive: T.dependencyFailures,
    check: ({ redis: cache }) => (cache.up ? null : 'Redis không trả lời lệnh PING (giới hạn tần suất, cache, hàng chờ chạy ở chế độ dự phòng)'),
  },
  {
    key: 'worker-down',
    title: 'Worker không chạy',
    check: ({ worker }) => {
      if (worker.mode !== 'bullmq' || worker.alive) return null;
      return worker.lastSeenAt ? `không có nhịp tim từ ${minutes(worker.ageMs)} phút trước` : 'chưa từng thấy nhịp tim của worker';
    },
  },
  {
    key: 'queue-backlog',
    title: 'Job nền bị dồn',
    check: ({ queues }) => {
      const stuck = (queues ?? []).filter((q) => q.waiting > T.queueWaiting || (q.oldestWaitingMs ?? 0) > T.queueOldestWaitMs);
      return stuck.length > 0
        ? stuck.map((q) => `${q.name}: ${q.waiting} job chờ, lâu nhất ${seconds(q.oldestWaitingMs ?? 0)} giây`).join('; ')
        : null;
    },
  },
  {
    key: 'jobs-failed',
    title: 'Nhiều job nền lỗi',
    check: ({ failedJobsLastHour }) =>
      failedJobsLastHour !== null && failedJobsLastHour > T.failedJobsPerHour ? `${failedJobsLastHour} job lỗi hẳn trong 1 giờ qua` : null,
  },
  {
    key: 'refunds-stuck',
    title: 'Hoàn tiền VNPay bị kẹt',
    check: ({ business }) => {
      if (!business || (business.refundsFailed === 0 && business.refundsPendingTooLong === 0)) return null;
      return `${business.refundsFailed} khoản thất bại, ${business.refundsPendingTooLong} khoản chờ quá ${minutes(T.refundPendingMs)} phút`;
    },
  },
  {
    key: 'disk-low',
    title: 'Ổ đĩa sắp đầy',
    check: ({ disk }) =>
      disk && disk.freePercent !== null && disk.freePercent < T.diskFreePercent ? `còn ${disk.freePercent}% (${disk.freeGb} GB)` : null,
  },
  {
    key: 'web-errors',
    title: 'Lỗi JavaScript trên web tăng vọt',
    check: ({ webErrors }) =>
      webErrors && webErrors.count > T.clientErrors ? `${webErrors.count} lỗi trong ${webErrors.windowMinutes} phút` : null,
  },
];
const TITLES = Object.fromEntries(RULES.map((rule) => [rule.key, rule.title]));

// --- state: Redis, or this process's memory when Redis is down ------------------------

const memory = { state: new Map(), history: [] };

async function readState() {
  try {
    const raw = await redis.hgetall(STATE_KEY);
    return new Map(Object.entries(raw).map(([key, value]) => [key, JSON.parse(value)]));
  } catch {
    return new Map(memory.state);
  }
}

async function writeState(key, value) {
  if (value) memory.state.set(key, value);
  else memory.state.delete(key);
  try {
    if (value) await redis.hset(STATE_KEY, key, JSON.stringify(value));
    else await redis.hdel(STATE_KEY, key);
  } catch {
    // kept in memory
  }
}

async function addHistory(entry) {
  memory.history = [entry, ...memory.history].slice(0, MONITORING.HISTORY_MAX);
  try {
    await redis
      .multi()
      .lpush(HISTORY_KEY, JSON.stringify(entry))
      .ltrim(HISTORY_KEY, 0, MONITORING.HISTORY_MAX - 1)
      .pexpire(HISTORY_KEY, KEEP_MS)
      .exec();
  } catch {
    // kept in memory
  }
}

// --- who is told ----------------------------------------------------------------------

let lastRecipients = [];
const settings = { extraEmails: env.ALERT_EMAILS };

/** Active accounts with system:monitor, plus ALERT_EMAILS. The database down: the last list known. */
async function recipients() {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT u.email
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code = 'system:monitor' AND u.status = 'ACTIVE'`,
    );
    lastRecipients = rows.map((row) => row.email);
  } catch {
    // keep lastRecipients
  }
  return [...new Set([...lastRecipients, ...settings.extraEmails])];
}

async function notify(kind, rule, entry) {
  const message = systemAlertEmail({ kind, title: rule.title, detail: entry.detail, since: new Date(entry.since), at: new Date(entry.at) });
  const to = await recipients();
  // One after the other: a burst of SMTP connections would slow the emails customers wait for.
  for (const address of to) {
    await mailer.sendMail({ to: address, ...message }).catch((err) => logger.error({ err, alert: rule.key }, 'Alert email not sent'));
  }
  logger.warn({ alert: rule.key, kind, detail: entry.detail, recipients: to.length }, 'Monitoring alert');
}

/**
 * One round of checks. `status`: from collectStatus (passed in by tests).
 * @returns {Promise<Array<{ key: string, kind: 'FIRING'|'REMINDER'|'RESOLVED' }>>} what was emailed
 */
async function runAlertCheck({ now = Date.now(), status } = {}) {
  const current = status ?? (await collectStatus({ now }));
  const state = await readState();
  const sent = [];
  for (const rule of RULES) {
    const detail = rule.check(current);
    const before = state.get(rule.key) ?? null;
    if (detail) {
      const failures = (before?.failures ?? 0) + 1;
      if (!before?.firing) {
        if (failures >= (rule.consecutive ?? 1)) {
          const entry = { firing: true, since: now, lastNotifiedAt: now, failures, detail };
          await writeState(rule.key, entry);
          await addHistory({ key: rule.key, title: rule.title, status: 'FIRING', detail, at: now });
          await notify('FIRING', rule, { ...entry, at: now });
          sent.push({ key: rule.key, kind: 'FIRING' });
        } else {
          await writeState(rule.key, { firing: false, failures, detail });
        }
      } else if (now - before.lastNotifiedAt >= MONITORING.REMIND_AFTER_MS) {
        const entry = { ...before, failures, detail, lastNotifiedAt: now };
        await writeState(rule.key, entry);
        await notify('REMINDER', rule, { ...entry, at: now });
        sent.push({ key: rule.key, kind: 'REMINDER' });
      } else {
        await writeState(rule.key, { ...before, failures, detail });
      }
    } else if (before?.firing) {
      await writeState(rule.key, null);
      await addHistory({ key: rule.key, title: rule.title, status: 'RESOLVED', detail: before.detail, at: now, since: before.since });
      await notify('RESOLVED', rule, { ...before, at: now });
      sent.push({ key: rule.key, kind: 'RESOLVED' });
    } else if (before) {
      await writeState(rule.key, null);
    }
  }
  return sent;
}

/** The alerts going on now, for the page. */
async function activeAlerts() {
  const state = await readState();
  return [...state.entries()]
    .filter(([, value]) => value.firing)
    .map(([key, value]) => ({ key, title: TITLES[key] ?? key, detail: value.detail, since: new Date(value.since).toISOString() }));
}

/** Started and ended alerts of the last MONITORING.HISTORY_DAYS days, newest first. */
async function alertHistory(now = Date.now()) {
  let entries;
  try {
    entries = (await redis.lrange(HISTORY_KEY, 0, MONITORING.HISTORY_MAX - 1)).map((raw) => JSON.parse(raw));
  } catch {
    entries = memory.history;
  }
  return entries
    .filter((entry) => now - entry.at <= KEEP_MS)
    .map((entry) => ({
      key: entry.key,
      title: entry.title,
      status: entry.status,
      detail: entry.detail,
      at: new Date(entry.at).toISOString(),
      since: entry.since ? new Date(entry.since).toISOString() : null,
    }));
}

/** Only one API process checks each minute (Redis lock); Redis down: each process checks. */
async function takeTurn() {
  try {
    return (await redis.set(LOCK_KEY, String(process.pid), 'PX', MONITORING.CHECK_INTERVAL_MS - 5_000, 'NX')) === 'OK';
  } catch {
    return true;
  }
}

function startAlertLoop() {
  const timer = setInterval(async () => {
    try {
      if (await takeTurn()) await runAlertCheck();
    } catch (err) {
      logger.error({ err }, 'Monitoring alert check failed');
    }
  }, MONITORING.CHECK_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/** For tests only: ALERT_EMAILS. */
function setAlertEmails(emails) {
  settings.extraEmails = emails;
}

/** For tests only. */
async function resetAlerts() {
  memory.state.clear();
  memory.history = [];
  lastRecipients = [];
  await redis.del(STATE_KEY, HISTORY_KEY, LOCK_KEY);
}

module.exports = { RULES, runAlertCheck, activeAlerts, alertHistory, startAlertLoop, resetAlerts, setAlertEmails };
