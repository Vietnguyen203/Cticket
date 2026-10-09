const http = require('node:http');
const env = require('./config/env');
const logger = require('./utils/logger');
const { createApp } = require('./app');
const { closePool } = require('./database/pool');
const { startOrderSweeper } = require('./modules/orders/orders.sweeper');

const server = http.createServer(createApp());

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API server listening');
});

const orderSweeper = startOrderSweeper();

let shuttingDown = false;

/**
 * Graceful shutdown (Docker sends SIGTERM on `docker compose stop`):
 *  1. stop accepting new connections and let in-flight requests finish,
 *  2. stop the order sweeper (letting a sweep in progress finish),
 *  3. close the PostgreSQL pool,
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
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await orderSweeper.stop();
    await closePool();
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
