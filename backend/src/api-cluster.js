const cluster = require('node:cluster');
const os = require('node:os');
const logger = require('./utils/logger');

/**
 * Several API processes in one container (bug review follow-up). One Node.js
 * process runs JavaScript on one CPU core: under a rush (1.000 people pressing
 * "join the queue" in the same second, 1.000 fighting over 50 seats) one
 * process saturates at ~1.150 requests/s and answers queue up (Phase 22). The
 * primary process only forks the workers, which share the port (the cluster
 * module hands them the connections). Nothing else changes: sessions, rate
 * limits, the purchase queue and caches live in Redis / PostgreSQL, and the
 * WebSocket hubs of all workers relay each other through Redis pub/sub.
 */

const RESTART_DELAY_MS = 1_000;
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASHES_PER_WINDOW = 5;
const MIN_POOL_PER_WORKER = 2;

/** API_WORKERS → a number of processes ('auto': the CPU cores). */
function workerCount(setting, cores = os.availableParallelism()) {
  return setting === 'auto' ? Math.max(1, cores) : setting;
}

/** PG_POOL_MAX is the container's budget of PostgreSQL connections: split between the workers. */
function poolPerWorker(poolMax, workers) {
  return Math.max(MIN_POOL_PER_WORKER, Math.floor(poolMax / workers));
}

/**
 * The primary: fork, restart a worker that dies (a crash is logged; a crash
 * loop stops the container so Docker restarts it and someone notices), and on
 * SIGTERM / SIGINT pass the signal on and wait for every worker's graceful
 * shutdown.
 */
function startCluster({ workers, poolMax, shutdownTimeoutMs }) {
  const pool = poolPerWorker(poolMax, workers);
  const crashes = [];
  let stopping = false;

  const fork = () => cluster.fork({ PG_POOL_MAX: String(pool), API_WORKERS: '1' });
  logger.info({ workers, pgPoolPerWorker: pool }, 'Starting API workers');
  for (let i = 0; i < workers; i++) fork();

  cluster.on('exit', (worker, code, signal) => {
    if (stopping) {
      if (Object.keys(cluster.workers).length === 0) {
        logger.info('All API workers stopped');
        process.exit(0);
      }
      return;
    }
    const now = Date.now();
    crashes.push(now);
    while (crashes.length > 0 && now - crashes[0] > CRASH_WINDOW_MS) crashes.shift();
    logger.error({ pid: worker.process.pid, code, signal }, 'API worker died; starting another');
    if (crashes.length > MAX_CRASHES_PER_WINDOW) {
      logger.fatal({ crashes: crashes.length }, 'API workers keep dying; stopping');
      process.exit(1);
    }
    setTimeout(fork, RESTART_DELAY_MS).unref();
  });

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Stopping API workers');
    for (const worker of Object.values(cluster.workers)) worker.process.kill(signal);
    // Each worker has its own shutdown timer; this one only covers a stuck worker.
    setTimeout(() => {
      logger.error('API workers did not stop in time; forcing exit');
      process.exit(1);
    }, shutdownTimeoutMs + 1_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

module.exports = { startCluster, workerCount, poolPerWorker };
