// Runs in every test worker BEFORE any application module is loaded,
// so src/config/env.js sees the test configuration.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set (see backend/.env.example)');
}

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
