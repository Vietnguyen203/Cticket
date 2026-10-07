const { pool } = require('./pool');
const logger = require('../utils/logger');

/**
 * Run `fn` inside a PostgreSQL transaction on ONE dedicated connection.
 *
 * Why a dedicated connection: a transaction lives on a single connection.
 * If BEGIN ran on connection #1 and the UPDATE on connection #2 (which is
 * what pool.query would do), the UPDATE would not be part of the transaction.
 * So every query inside `fn` MUST use the `client` argument, never pool.query.
 *
 * Guarantees:
 *  - COMMIT only if `fn` resolves.
 *  - ROLLBACK if `fn` throws (or COMMIT fails); the ORIGINAL error is rethrown.
 *  - The connection is always returned to the pool (finally). A connection
 *    whose ROLLBACK failed is in an unknown state, so it is destroyed instead
 *    of being reused by the next request.
 *
 * Rule: no network calls other than this client inside `fn` (no Redis, HTTP,
 * queue, WebSocket). Row locks are held until COMMIT/ROLLBACK, so any slow
 * call inside the transaction makes every other request wait on those locks.
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  let clientIsBroken = false;

  // The pool only listens for 'error' on IDLE clients. If the connection dies
  // while we hold it (e.g. PostgreSQL restarts mid-transaction), pg emits
  // 'error' on the client; with no listener, Node would crash the whole
  // process. The pending query rejects anyway, so logging is enough here.
  const onClientError = (err) => {
    clientIsBroken = true;
    logger.warn({ err }, 'PostgreSQL connection lost during transaction');
  };
  client.on('error', onClientError);

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      clientIsBroken = true;
      logger.error({ err: rollbackErr }, 'ROLLBACK failed; destroying PostgreSQL client');
    }
    throw err;
  } finally {
    client.off('error', onClientError);
    // release(true) destroys the connection instead of returning it to the pool.
    client.release(clientIsBroken);
  }
}

module.exports = { withTransaction };
