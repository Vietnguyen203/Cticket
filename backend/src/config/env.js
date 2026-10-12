const path = require('node:path');
const dotenv = require('dotenv');
const { z } = require('zod');

// Load backend/.env if present. Variables already set in the real environment
// (Docker, CI) take precedence because dotenv does not override by default.
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const csv = (value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const MIN_SECRET_LENGTH = 32;
const secret = z.string().min(MIN_SECRET_LENGTH, `must be at least ${MIN_SECRET_LENGTH} characters`);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
  PG_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  PG_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  CORS_ORIGINS: z.string().default('').transform(csv),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Auth
  JWT_ACCESS_SECRET: secret,
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_ISSUER: z.string().default('etp-api'),
  JWT_AUDIENCE: z.string().default('etp-app'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // Server-side key for hashing OTP codes (HMAC). Without it, a leaked
  // database would let an attacker brute-force all 1,000,000 codes offline.
  OTP_SECRET: secret,
  // bcrypt work factor: each +1 doubles hashing time. 12 ≈ 250 ms per hash.
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

  // Email (SMTP). In development this points to the Mailpit container.
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: booleanString.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Event Tickets <no-reply@etp.local>'),

  // Redis: cache, rate limits, OTP codes, seat locks, token denylist.
  // Everything there has a TTL; PostgreSQL stays the source of truth.
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  // A slow Redis must not make the API slow: give up on a command after this.
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(200),
  RATE_LIMIT_ENABLED: booleanString.default(true),
  // Behind a reverse proxy: number of proxy hops to trust for the client IP.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // WebSocket: ping every N seconds; a client that misses one ping is dropped.
  WS_HEARTBEAT_SECONDS: z.coerce.number().int().min(1).max(300).default(30),

  // Booking: how long a HELD order keeps its seats, and how often expired
  // holds are swept back into stock (in-process until BullMQ in Phase 9).
  HOLD_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  // Checkout extends the hold once by this much, to pay (CTicket: 10 + 10 minutes).
  PAYMENT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  ORDER_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),

  // Used only by `npm run seed:admin`.
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast: a misconfigured process must not start serving traffic.
  // Only variable names and messages are printed, never values.
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  console.error(`Invalid environment configuration:\n${issues.join('\n')}`);
  process.exit(1);
}

module.exports = Object.freeze(parsed.data);
