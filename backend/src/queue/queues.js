const IORedis = require('ioredis');
const { Queue } = require('bullmq');
const env = require('../config/env');
const { VNPAY } = require('../config/constants');
const logger = require('../utils/logger');

/**
 * Background jobs (Phase 9). The API only ENQUEUES; src/worker.js runs them.
 * See docs/phase-9-queue-design.md.
 *
 * Every job must be safe to run twice (a retry, a crashed worker, the
 * reconciliation job): the data it touches is protected by unique
 * constraints and compare-and-set updates, as everywhere else.
 */
const QUEUE = Object.freeze({
  TICKETS: 'tickets', // issue tickets for a paid order
  EMAILS: 'emails', // OTP, order confirmation, refund
  HOLDS: 'holds', // expire one order at its deadline
  NOTIFICATIONS: 'notifications', // in-app notification + WebSocket push
  MAINTENANCE: 'maintenance', // repeatable: reconcile tickets, sweep holds, finish shows
  PAYMENTS: 'payments', // Phase 17: refunds sent to VNPay
});

// BullMQ adds its own key layout under this prefix (ioredis keyPrefix is not allowed).
const PREFIX = 'etp:bull';
const DAY_SECONDS = 24 * 60 * 60;
const ENQUEUE_TIMEOUT_MS = 1_000;

const retryDelay = env.QUEUE_RETRY_DELAY_MS;
const KEEP = {
  // Completed jobs are kept a day, so a duplicate jobId (e.g. issue-<orderId>) is still ignored.
  removeOnComplete: { age: DAY_SECONDS, count: 10_000 },
  // Failed jobs are kept a week to see why (Bull Board in Phase 12).
  removeOnFail: { age: 7 * DAY_SECONDS },
};

const JOB_OPTIONS = {
  [QUEUE.TICKETS]: { ...KEEP, attempts: 10, backoff: { type: 'exponential', delay: retryDelay } },
  [QUEUE.EMAILS]: { ...KEEP, attempts: 5, backoff: { type: 'exponential', delay: 2 * retryDelay } },
  [QUEUE.HOLDS]: { ...KEEP, attempts: 3, backoff: { type: 'fixed', delay: retryDelay } },
  [QUEUE.NOTIFICATIONS]: { ...KEEP, attempts: 5, backoff: { type: 'exponential', delay: retryDelay } },
  [QUEUE.MAINTENANCE]: { removeOnComplete: true, removeOnFail: { age: DAY_SECONDS }, attempts: 1 },
  // VNPay may be down for a while: 5 tries over ~10 minutes, then the refund is FAILED (admin retries).
  [QUEUE.PAYMENTS]: { ...KEEP, attempts: VNPAY.REFUND_ATTEMPTS, backoff: { type: 'exponential', delay: 8 * retryDelay } },
};

const settings = { mode: env.QUEUE_MODE };

let connection = null;
const queues = new Map();

/**
 * Producer connection. Not the shared "etp:"-prefixed client (BullMQ refuses
 * a keyPrefix), and no offline queue: if Redis is down, adding a job fails
 * fast instead of holding the request.
 */
function producerConnection() {
  if (!connection) {
    // Created on the first enqueue only: tests in inline mode never connect.
    connection = new IORedis(env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    connection.on('error', () => {}); // reported when an enqueue actually fails
  }
  return connection;
}

function getQueue(name) {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection: producerConnection(), prefix: PREFIX }));
  }
  return queues.get(name);
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Put a job on a queue. Never throws: the caller's work is already
 * committed, and every job type has a fallback (reconciliation, the hold
 * sweeper, "resend code"). Job data is never logged (it may hold an OTP).
 *
 * @param {string} queueName  one of QUEUE
 * @param {string} jobName
 * @param {object} data
 * @param {import('bullmq').JobsOptions} [options]  e.g. jobId, delay
 */
async function enqueue(queueName, jobName, data, options = {}) {
  if (settings.mode === 'inline') {
    // Tests: run now, in this process. Timed jobs need a real queue; the
    // tests trigger them directly instead.
    if (options.delay > 0) return;
    try {
      // Required here, not at the top: the processors use the modules that enqueue.
      await require('./processors').run(queueName, { name: jobName, data, attemptsMade: 0 });
    } catch (err) {
      logger.error({ err, queue: queueName, job: jobName }, 'Inline job failed');
    }
    return;
  }

  try {
    await withTimeout(getQueue(queueName).add(jobName, data, { ...JOB_OPTIONS[queueName], ...options }), ENQUEUE_TIMEOUT_MS);
  } catch (err) {
    logger.error({ err, queue: queueName, job: jobName }, 'Could not enqueue a job; its fallback will cover it');
  }
}

/** Enqueue once the caller's transaction has committed (never for a rolled-back change). */
function enqueueAfterCommit(db, queueName, jobName, data, options) {
  const send = () => enqueue(queueName, jobName, data, options);
  if (typeof db.afterCommit === 'function') {
    db.afterCommit(send);
    return undefined;
  }
  return send();
}

async function closeQueues() {
  await Promise.all([...queues.values()].map((queue) => queue.close().catch(() => {})));
  queues.clear();
  if (connection) {
    connection.disconnect();
    connection = null;
  }
}

/** For tests only: switch between inline and real BullMQ. */
function setQueueMode(mode) {
  settings.mode = mode;
}

module.exports = { QUEUE, PREFIX, JOB_OPTIONS, enqueue, enqueueAfterCommit, getQueue, closeQueues, setQueueMode };
