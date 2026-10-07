const { pool } = require('../../src/database/pool');

/**
 * Run `fn` in a transaction that is ALWAYS rolled back, so each test leaves
 * the database exactly as it found it.
 */
async function inRollbackTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/**
 * Assert that `fn` fails with a PostgreSQL error, without breaking the
 * surrounding test transaction.
 *
 * In PostgreSQL, once a statement fails inside a transaction, the whole
 * transaction is "aborted" and every later statement errors until ROLLBACK.
 * A SAVEPOINT lets us roll back only the failed statement and keep going.
 */
async function expectPgError(client, fn, { code, constraint } = {}) {
  await client.query('SAVEPOINT expect_pg_error');
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  await client.query('ROLLBACK TO SAVEPOINT expect_pg_error');

  if (!caught) throw new Error('Expected a PostgreSQL error, but the statement succeeded');
  if (code) expect(caught.code).toBe(code);
  if (constraint) expect(caught.constraint).toBe(constraint);
  return caught;
}

module.exports = { inRollbackTransaction, expectPgError };
