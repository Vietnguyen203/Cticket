const IORedis = require('ioredis');
const { Worker } = require('bullmq');
const env = require('./config/env');
const { PURCHASE_QUEUE } = require('./config/constants');
const logger = require('./utils/logger');
const { closePool } = require('./database/pool');
const { closeRedis } = require('./redis/client');
const { QUEUE, PREFIX, getQueue, closeQueues } = require('./queue/queues');
const processors = require('./queue/processors');

const MINUTE_MS = 60_000;

/** Repeatable maintenance jobs (BullMQ runs each one on a single worker at a time). */
const MAINTENANCE_SCHEDULE = [
  { name: 'reconcile-tickets', every: MINUTE_MS }, // Q-04
  { name: 'sweep-holds', every: env.ORDER_SWEEP_INTERVAL_SECONDS * 1000 }, // Q-03 safety net
  { name: 'finish-shows', every: 10 * MINUTE_MS },
  // Phase 17: VNPay attempts at their order's deadline are asked about before the seats are released.
  { name: 'reconcile-payments', every: MINUTE_MS },
  // Phase 18.1: login lock streaks older than a day.
  { name: 'purge-login-attempts', every: 60 * MINUTE_MS },
  // Phase 18.2: reminders 24 hours / 2 hours before the show.
  { name: 'send-reminders', every: 5 * MINUTE_MS },
  // Phase 18.4: freed places go to the waiting list.
  { name: 'offer-waitlist', every: MINUTE_MS },
  // Phase 19: events' review figures checked against the reviews.
  { name: 'reconcile-ratings', every: 24 * 60 * MINUTE_MS },
  // Phase 21: purchase queues let the next people in when turns run out.
  { name: 'admit-queues', every: PURCHASE_QUEUE.ADMIT_INTERVAL_SECONDS * 1000 },
];

/**
 * Start one BullMQ worker per queue (Phase 9). The API only enqueues; this
 * process does the work, and more copies can run side by side.
 * @returns {Promise<{ stop: () => Promise<void> }>} stop() waits for running jobs
 */
async function startWorkers({ concurrency = env.WORKER_CONCURRENCY, schedule = true } = {}) {
  // Workers block on Redis while waiting for jobs: BullMQ requires maxRetriesPerRequest null.
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on('error', (err) => logger.warn({ err }, 'Worker Redis connection error'));

  const workers = Object.values(QUEUE).map((name) => {
    const worker = new Worker(name, (job) => processors.run(name, job), {
      connection,
      prefix: PREFIX,
      concurrency: name === QUEUE.MAINTENANCE ? 1 : concurrency,
    });
    // Job data is never logged: an OTP job carries the code.
    worker.on('failed', (job, err) =>
      logger.warn({ err, queue: name, job: job?.name, jobId: job?.id, attempt: job?.attemptsMade }, 'Job failed'),
    );
    worker.on('error', (err) => logger.error({ err, queue: name }, 'Worker error'));
    return worker;
  });

  if (schedule) {
    const maintenance = getQueue(QUEUE.MAINTENANCE);
    for (const { name, every } of MAINTENANCE_SCHEDULE) {
      await maintenance.upsertJobScheduler(name, { every }, { name });
    }
  }

  return {
    workers,
    async stop() {
      // close() lets the jobs in progress finish (INF-07), then stops fetching new ones.
      await Promise.all(workers.map((worker) => worker.close()));
      connection.disconnect();
    },
  };
}

if (require.main === module) {
  let running;
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Worker shutting down; waiting for running jobs');
    const forceExit = setTimeout(() => {
      logger.error('Worker shutdown timed out; forcing exit');
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS * 2);
    forceExit.unref();
    try {
      await running?.stop();
      await closeQueues();
      await closePool();
      await closeRedis();
      logger.info('Worker stopped');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during worker shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  startWorkers()
    .then((started) => {
      running = started;
      logger.info({ queues: Object.values(QUEUE), concurrency: env.WORKER_CONCURRENCY }, 'Worker started');
    })
    .catch((err) => {
      logger.fatal({ err }, 'Worker failed to start');
      process.exit(1);
    });
}

module.exports = { startWorkers, MAINTENANCE_SCHEDULE };
