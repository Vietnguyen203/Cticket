// Runs in every test worker BEFORE any application module is loaded,
// so src/config/env.js sees the test configuration.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set (see backend/.env.example)');
}
if (!process.env.TEST_REDIS_URL) {
  throw new Error('TEST_REDIS_URL is not set (see backend/.env.example)');
}

const TEST_SECRET = 'test-only-secret-that-is-at-least-32-characters-long';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.REDIS_URL = process.env.TEST_REDIS_URL;
// Tests must NEVER send real email, whatever backend/.env says (it may hold a
// real Gmail account). Point SMTP at a closed local port: if a test forgets
// the fake mailbox, sending fails fast and is only logged.
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '9';
process.env.SMTP_SECURE = 'false';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
// Hundreds of requests come from 127.0.0.1; the rate limit tests switch it back on.
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.JWT_ACCESS_SECRET ??= TEST_SECRET;
process.env.OTP_SECRET ??= TEST_SECRET;
process.env.QR_SECRET ??= TEST_SECRET;
// Jobs run inline, inside the request, so tests see emails and tickets at
// once; the queue tests switch to real BullMQ workers.
process.env.QUEUE_MODE = 'inline';
process.env.QUEUE_RETRY_DELAY_MS = '50';
// Minimum bcrypt cost: hashing in tests should take ~1 ms, not ~250 ms.
process.env.BCRYPT_COST = '4';
