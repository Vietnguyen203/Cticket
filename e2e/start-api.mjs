/**
 * Started by Playwright (webServer): a fresh E2E database, then the real API.
 *
 *  1. drop and recreate the "..._e2e" database, run every migration
 *  2. empty the E2E Redis database
 *  3. seed the E2E admin
 *  4. start backend/src/server.js with E2E settings (mail → Mailpit)
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { startFakeVnpay } from './support/fake-vnpay.mjs'
import {
  API_PORT,
  API_URL,
  BACKEND_DIR,
  E2E_ADMIN,
  E2E_TOTP_SECRET,
  FAKE_VNPAY_PORT,
  FAKE_VNPAY_URL,
  MAILPIT_SMTP_PORT,
  WEB_URL,
  stackUrls,
} from './stack.mjs'

const require = createRequire(path.join(BACKEND_DIR, 'package.json'))
const { Client } = require('pg')
const Redis = require('ioredis')

const { database, redis } = stackUrls()
const databaseName = new URL(database).pathname.slice(1)
if (!databaseName.endsWith('_e2e')) throw new Error(`Refusing to reset "${databaseName}": the E2E database name must end with _e2e`)

// 1. Fresh database
const maintenance = new URL(database)
maintenance.pathname = '/postgres'
const client = new Client({ connectionString: maintenance.toString() })
await client.connect()
await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
await client.query(`CREATE DATABASE "${databaseName}"`)
await client.end()
execFileSync(
  process.execPath,
  [
    path.join(BACKEND_DIR, 'node_modules/node-pg-migrate/bin/node-pg-migrate.js'),
    '-m', path.join(BACKEND_DIR, 'migrations'),
    '-j', 'sql',
    '--migration-filename-format', 'utc',
    '--no-verbose',
    'up',
  ],
  { env: { ...process.env, DATABASE_URL: database }, stdio: 'pipe' },
)

// The fake VNPay (support/fake-vnpay.mjs): its IPN calls this API.
const VNPAY = { tmnCode: 'E2ETMN01', secret: 'e2e-only-vnpay-hash-secret' }
await startFakeVnpay({ port: FAKE_VNPAY_PORT, ...VNPAY, ipnUrl: `${API_URL}/api/v1/payments/vnpay/ipn` })

// 2. Empty Redis db
const redisClient = new Redis(redis, { lazyConnect: true, maxRetriesPerRequest: 1 })
await redisClient.connect()
await redisClient.flushdb()
await redisClient.quit()

// 4 (settings first: src/config/env.js reads them when first required). Every
// mail setting is set explicitly so nothing from backend/.env (maybe a real
// Gmail account) is used; dotenv never overrides variables that exist.
Object.assign(process.env, {
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  LOG_LEVEL: process.env.E2E_API_LOG_LEVEL ?? 'warn',
  DATABASE_URL: database,
  REDIS_URL: redis,
  JWT_ACCESS_SECRET: 'e2e-only-secret-that-is-at-least-32-characters',
  OTP_SECRET: 'e2e-only-otp-secret-at-least-32-characters-long',
  QR_SECRET: 'e2e-only-qr-secret-at-least-32-characters-long',
  TOTP_ENCRYPTION_KEY: Buffer.from('e2e-only-totp-key-of-32-bytes!!!').toString('base64'),
  TWO_FACTOR_REQUIRED_ROLES: 'ADMIN',
  SMTP_HOST: 'localhost',
  SMTP_PORT: MAILPIT_SMTP_PORT,
  SMTP_SECURE: 'false',
  SMTP_USER: '',
  SMTP_PASS: '',
  MAIL_FROM: 'Event Tickets E2E <no-reply@e2e.test>',
  QUEUE_MODE: 'inline',
  // Every request comes from 127.0.0.1; the limits have their own Jest tests.
  RATE_LIMIT_ENABLED: 'false',
  // Phase 23: no alert emails from this stack (this machine's disk would email every test admin).
  MONITORING_ALERTS: 'false',
  // A laptop running several browsers + Vite + Docker sometimes answers Redis
  // in more than the 200 ms default: cache and locks then degrade as designed,
  // but sign-up codes (Redis only) fail with 503. Seen while writing these
  // tests; see docs/phase-13-testing-design.md, section 8.
  REDIS_COMMAND_TIMEOUT_MS: '1000',
  BCRYPT_COST: '4',
  CORS_ORIGINS: WEB_URL,
  UPLOAD_DIR: path.join(os.tmpdir(), 'etp-e2e-uploads'),
  ADMIN_EMAIL: E2E_ADMIN.email,
  ADMIN_PASSWORD: E2E_ADMIN.password,
  ADMIN_TOTP_SECRET: E2E_TOTP_SECRET,
  // Phase 17: VNPay is the fake one below (test-only values); the simulator stays on.
  VNPAY_TMN_CODE: VNPAY.tmnCode,
  VNPAY_HASH_SECRET: VNPAY.secret,
  VNPAY_PAY_URL: `${FAKE_VNPAY_URL}/paymentv2/vpcpay.html`,
  VNPAY_API_URL: `${FAKE_VNPAY_URL}/merchant_webapi/api/transaction`,
  VNPAY_RETURN_URL: `${WEB_URL}/payments/vnpay/return`,
  PAYMENT_SIMULATOR: 'true',
})

// 3. Admin
const { seedAdmin } = require('./src/scripts/seedAdmin')
await seedAdmin()

require('./src/server')

// Phase 18.4: the E2E stack has no worker; run its "offer-waitlist" job here, often,
// so a freed place reaches the waiting list within seconds.
const { offerSpacesToWaitlist } = require('./src/modules/waitlist')
setInterval(() => offerSpacesToWaitlist().catch(() => {}), 2000)
