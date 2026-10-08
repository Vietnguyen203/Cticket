// Runs in every test worker BEFORE any application module is loaded,
// so src/config/env.js sees the test configuration.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set (see backend/.env.example)');
}

const TEST_SECRET = 'test-only-secret-that-is-at-least-32-characters-long';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET ??= TEST_SECRET;
process.env.OTP_SECRET ??= TEST_SECRET;
// Minimum bcrypt cost: hashing in tests should take ~1 ms, not ~250 ms.
process.env.BCRYPT_COST = '4';
