const http = require('node:http');
const env = require('./config/env');
const logger = require('./utils/logger');
const { createApp } = require('./app');
const { closePool } = require('./database/pool');
const { redis, closeRedis } = require('./redis/client');
const { closeQueues } = require('./queue/queues');
const { RealtimeHub } = require('./realtime/hub');

const server = http.createServer(createApp());
// Behind a proxy that keeps connections open (nginx upstream keepalive, cloud
// load balancers: 60 s idle), the API must keep an idle connection LONGER than
// the proxy, or it closes one just as the proxy sends a request on it: the
// proxy gets "connection reset", answers 502 and may mark the API down
// (found by the Phase 13 load test). Node's default is 5 s.
const KEEP_ALIVE_TIMEOUT_MS = 65_000;
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 1_000; // must be larger than keepAliveTimeout
// WebSocket endpoint /ws on the same port as the REST API.
const realtimeHub = new RealtimeHub();
realtimeHub.attach(server).catch((err) => logger.error({ err }, 'Failed to start the WebSocket endpoint'));

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API server listening');
});

// Connect now so the first requests do not pay for it. If Redis is down the
// API still starts (cache, rate limits and seat locks are skipped) and
// ioredis keeps reconnecting in the background.
redis.connect().catch((err) => logger.warn({ err }, 'Redis not reachable at startup; continuing without it'));


let shuttingDown = false;

/**
 * Graceful shutdown (Docker sends SIGTERM on `docker compose stop`):
 *  1. close WebSockets (clients reconnect elsewhere), stop accepting new
 *     connections and let in-flight requests finish,
 *  2. close the job queue connection (jobs themselves run in src/worker.js),
 *  3. close the PostgreSQL pool and the Redis connection,
 *  4. exit. A timer forces exit if something hangs.
 */
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  const forceExitTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  try {
    // Open WebSockets would keep server.close() waiting forever: close them first.
    await realtimeHub.close();
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await closeQueues();
    await closePool();
    await closeRedis();
    logger.info('Shutdown complete');
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    exitCode = 1;
  }
  process.exit(exitCode);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A rejected promise nobody awaited means a bug and possibly inconsistent
// state: log it and restart cleanly rather than limp along.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException', 1);
});
