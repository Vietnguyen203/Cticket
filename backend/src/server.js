const cluster = require('node:cluster');
const env = require('./config/env');
const { startCluster, workerCount } = require('./api-cluster');

/**
 * Entry point of the API (npm start, Docker CMD, E2E). API_WORKERS = 1 (the
 * default): this process is the server. More (or 'auto'): this process forks
 * that many servers sharing the port (api-cluster.js) and only watches them.
 */
const workers = workerCount(env.API_WORKERS);

if (cluster.isPrimary && workers > 1) {
  startCluster({ workers, poolMax: env.PG_POOL_MAX, shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS });
} else {
  require('./api-process');
}
