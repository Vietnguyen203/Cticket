const { Pool, types } = require('pg');
const env = require('../config/env');
const logger = require('../utils/logger');

const PG_INT8_OID = 20;

/**
 * BIGINT (int8) → JS number.
 * node-postgres returns BIGINT as a string by default because int8 can exceed
 * Number.MAX_SAFE_INTEGER (2^53 - 1 ≈ 9 × 10^15). In this schema BIGINT holds
 * money in integer minor units (VND) and COUNT(*) results; both stay far below
 * that limit, so integer arithmetic in JS stays exact (no float rounding,
 * because amounts are whole numbers).
 */
types.setTypeParser(PG_INT8_OID, (value) => Number(value));

/**
 * One shared pool per process. Each request borrows a connection for the
 * duration of a query (pool.query) or a transaction (pool.connect), then
 * gives it back. Opening a fresh TCP connection + auth per query would cost
 * several milliseconds; the pool amortises that.
 */
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: env.PG_IDLE_TIMEOUT_MS,
  // How long pool.connect() may wait for a free connection before failing.
  connectionTimeoutMillis: env.PG_CONNECTION_TIMEOUT_MS,
  // Server-side guard: PostgreSQL cancels any single statement running longer.
  statement_timeout: env.PG_STATEMENT_TIMEOUT_MS,
  application_name: `etp-${env.NODE_ENV}`,
});

// An idle client can error out (e.g. PostgreSQL restarted). Without this
// listener the 'error' event would be unhandled and crash the process.
// The pool discards the broken client and creates a new one on demand.
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

/**
 * Run a single parameterized query on any free pooled connection.
 * Use ONLY for statements that do not need to share a transaction.
 * @param {string} text  SQL with $1, $2 … placeholders — never string-concatenate values
 * @param {unknown[]} [params]
 */
function query(text, params) {
  return pool.query(text, params);
}

async function checkDatabase() {
  await pool.query('SELECT 1');
}

function closePool() {
  return pool.end();
}

module.exports = { pool, query, checkDatabase, closePool };
