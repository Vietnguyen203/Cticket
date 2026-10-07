const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const MIGRATE_BIN = path.resolve(__dirname, '../../node_modules/node-pg-migrate/bin/node-pg-migrate.js');
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');
const ALL_MIGRATIONS = '9999';

function runMigrations(databaseUrl, ...args) {
  execFileSync(process.execPath, [MIGRATE_BIN, '-m', MIGRATIONS_DIR, '--no-verbose', ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}

/**
 * Runs once before the whole test suite:
 *  1. wipe the test database schema,
 *  2. migrate up, all the way down, and up again — so every run also proves
 *     that each Down Migration really reverses its Up Migration.
 */
module.exports = async function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is not set');

  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    // Safety net: this setup drops every table. Never point it at real data.
    throw new Error(`Refusing to reset "${databaseName}": test database name must end with "_test"`);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  try {
    runMigrations(databaseUrl, 'up');
    runMigrations(databaseUrl, 'down', ALL_MIGRATIONS);
    runMigrations(databaseUrl, 'up');
  } catch (err) {
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n');
    throw new Error(`Migration failed:\n${output}`);
  }
};
