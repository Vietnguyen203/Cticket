const { pool, query, closePool } = require('../../src/database/pool');
const { withTransaction } = require('../../src/database/transaction');

const TABLE = 'tx_helper_test';
const LOCK_HOLD_MS = 300;
const TIMER_TOLERANCE_MS = 50;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checkedOutClients = () => pool.totalCount - pool.idleCount;

beforeAll(() => query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id int PRIMARY KEY, value int NOT NULL)`));
beforeEach(() => query(`TRUNCATE ${TABLE}`));
afterAll(async () => {
  await query(`DROP TABLE IF EXISTS ${TABLE}`);
  await closePool();
});

describe('withTransaction', () => {
  test('commits when the callback resolves, and returns its result', async () => {
    const result = await withTransaction(async (client) => {
      await client.query(`INSERT INTO ${TABLE} (id, value) VALUES (1, 10)`);
      return 'done';
    });

    expect(result).toBe('done');
    const { rows } = await query(`SELECT value FROM ${TABLE} WHERE id = 1`);
    expect(rows).toEqual([{ value: 10 }]);
    expect(checkedOutClients()).toBe(0);
  });

  test('rolls back every statement when the callback throws, and rethrows the same error', async () => {
    const failure = new Error('business rule failed');

    await expect(
      withTransaction(async (client) => {
        await client.query(`INSERT INTO ${TABLE} (id, value) VALUES (1, 10)`);
        await client.query(`INSERT INTO ${TABLE} (id, value) VALUES (2, 20)`);
        throw failure;
      }),
    ).rejects.toBe(failure);

    const { rows } = await query(`SELECT count(*) AS count FROM ${TABLE}`);
    expect(rows[0].count).toBe(0); // no partial writes
    expect(checkedOutClients()).toBe(0);
  });

  test('rolls back when a SQL statement fails (e.g. constraint violation)', async () => {
    await expect(
      withTransaction(async (client) => {
        await client.query(`INSERT INTO ${TABLE} (id, value) VALUES (1, 10)`);
        await client.query(`INSERT INTO ${TABLE} (id, value) VALUES (1, 99)`); // duplicate PK
      }),
    ).rejects.toMatchObject({ code: '23505' });

    const { rows } = await query(`SELECT count(*) AS count FROM ${TABLE}`);
    expect(rows[0].count).toBe(0);
  });

  test('survives a connection killed mid-transaction, and the pool keeps working', async () => {
    await expect(
      withTransaction(async (client) => {
        // Kill our own server connection: the query fails AND the following ROLLBACK fails.
        await client.query('SELECT pg_terminate_backend(pg_backend_pid())');
      }),
    ).rejects.toThrow();

    expect(checkedOutClients()).toBe(0);
    const { rows } = await query('SELECT 1 AS ok');
    expect(rows).toEqual([{ ok: 1 }]);
  });

  test('SELECT ... FOR UPDATE makes a second transaction wait, then see the committed value', async () => {
    await query(`INSERT INTO ${TABLE} (id, value) VALUES (1, 0)`);

    let signalLocked;
    const firstHasLock = new Promise((resolve) => { signalLocked = resolve; });

    // Transaction A: lock the row, hold the lock for a while, then change it.
    const transactionA = withTransaction(async (client) => {
      await client.query(`SELECT value FROM ${TABLE} WHERE id = 1 FOR UPDATE`);
      signalLocked();
      await delay(LOCK_HOLD_MS);
      await client.query(`UPDATE ${TABLE} SET value = 1 WHERE id = 1`);
    });

    // Transaction B: tries to lock the same row while A holds it.
    await firstHasLock;
    const startedAt = Date.now();
    const valueSeenByB = await withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT value FROM ${TABLE} WHERE id = 1 FOR UPDATE`);
      return rows[0].value;
    });
    const waitedMs = Date.now() - startedAt;
    await transactionA;

    // B blocked until A committed, then read A's committed value, not the stale 0.
    // This is exactly what stops "check-then-act" double booking.
    expect(valueSeenByB).toBe(1);
    expect(waitedMs).toBeGreaterThanOrEqual(LOCK_HOLD_MS - TIMER_TOLERANCE_MS);
  });
});
