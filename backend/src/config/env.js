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
  // API processes in one container (Node.js uses one CPU core per process): a number, or 'auto' = the
  // CPU cores. PG_POOL_MAX is then shared between them (api-cluster.js). Bug review follow-up.
  API_WORKERS: z.union([z.literal('auto'), z.coerce.number().int().min(1).max(32)]).default(1),
  PG_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  PG_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  CORS_ORIGINS: z.string().default('').transform(csv),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // Event images uploaded from the web (Phase 12.2). A Docker volume in production.
  UPLOAD_DIR: z.string().min(1).default(path.resolve(__dirname, '../../uploads')),

  // Auth
  JWT_ACCESS_SECRET: secret,
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_ISSUER: z.string().default('etp-api'),
  JWT_AUDIENCE: z.string().default('etp-app'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // A token rotated this recently, whose successor was never used, still works once (lost response; 0: never).
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(60).default(10),
  // Server-side key for hashing OTP codes (HMAC). Without it, a leaked
  // database would let an attacker brute-force all 1,000,000 codes offline.
  OTP_SECRET: secret,
  // bcrypt work factor: each +1 doubles hashing time. 12 ≈ 250 ms per hash.
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

  // Two-factor authentication (Phase 15). The key encrypts every TOTP secret
  // in the database (AES-256-GCM): 32 random bytes, base64. Losing it means
  // every user has to set two-factor up again, so back it up like the others.
  TOTP_ENCRYPTION_KEY: z
    .string()
    .transform((value) => Buffer.from(value, 'base64'))
    .refine((key) => key.length === 32, 'must be 32 random bytes, base64-encoded'),
  // Roles that cannot use the platform without two-factor (comma-separated). Must include ADMIN in
  // production (checked below), unless ALLOW_ADMIN_WITHOUT_2FA=true (a local Docker stack only).
  TWO_FACTOR_REQUIRED_ROLES: z.string().default('ADMIN').transform(csv),
  ALLOW_ADMIN_WITHOUT_2FA: booleanString.default(false),
  // The name authenticator apps show next to the code.
  TOTP_ISSUER: z.string().min(1).max(50).default('ETP Tickets'),

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
  // Web app refresh cookie (Phase 11): Secure by default in production only.
  REFRESH_COOKIE_SECURE: booleanString.optional(),
  // Behind a reverse proxy: number of proxy hops to trust for the client IP.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // WebSocket: ping every N seconds; a client that misses one ping is dropped.
  WS_HEARTBEAT_SECONDS: z.coerce.number().int().min(1).max(300).default(30),

  // Signs ticket QR codes (Phase 9/10): a QR cannot be forged without it.
  QR_SECRET: secret,

  // Background jobs (BullMQ). "inline" runs a job right away in the calling
  // process instead: used by the test suite so it does not need a worker.
  QUEUE_MODE: z.enum(['bullmq', 'inline']).default('bullmq'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  // First retry delay of a failed job; later retries wait longer (exponential).
  QUEUE_RETRY_DELAY_MS: z.coerce.number().int().min(10).max(600_000).default(5_000),

  // Booking: how long a HELD order keeps its seats, and how often expired
  // holds are swept back into stock (in-process until BullMQ in Phase 9).
  HOLD_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  // Checkout extends the hold once by this much, to pay (CTicket: 10 + 10 minutes).
  PAYMENT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  // Safety-net sweep of expired holds, run by the worker (each order also has its own timed job).
  ORDER_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),

  // Payments (Phase 17). VNPay is on when both the TMN code and the hash secret
  // are set (sandbox registration email). The simulated provider pays for free:
  // off by default in production (set PAYMENT_SIMULATOR=true only for a demo).
  VNPAY_TMN_CODE: z.string().trim().optional(),
  VNPAY_HASH_SECRET: z.string().trim().optional(),
  VNPAY_PAY_URL: z.url().default('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
  VNPAY_API_URL: z.url().default('https://sandbox.vnpayment.vn/merchant_webapi/api/transaction'),
  // The web page VNPay sends the customer back to (frontend route /payments/vnpay/return).
  VNPAY_RETURN_URL: z.url().default('http://localhost:8080/payments/vnpay/return'),
  // This server's address, sent with querydr / refund calls (VNPay requires one).
  VNPAY_SERVER_IP: z.string().default('127.0.0.1'),
  VNPAY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  PAYMENT_SIMULATOR: booleanString.optional(),

  // Phase 23: monitoring alerts also go to these addresses (comma-separated),
  // besides every active account with the system:monitor permission.
  ALERT_EMAILS: z.string().default('').transform(csv).pipe(z.array(z.email())),
  // The alert check (every minute). Off on test stacks: their machine's disk or
  // load would email every test admin.
  MONITORING_ALERTS: booleanString.default(true),

  // Used only by `npm run seed:admin`.
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  // Test stacks only (E2E): the seeded admin gets this TOTP secret, so tests can compute its codes.
  ADMIN_TOTP_SECRET: z.string().optional(),
});

const parsed = envSchema
  // Bug review BUG-05: a value copied from a development .env (e.g. NONE) must not
  // quietly let admins of a real server sign in without two-factor.
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.TWO_FACTOR_REQUIRED_ROLES.includes('ADMIN') && !env.ALLOW_ADMIN_WITHOUT_2FA) {
      ctx.addIssue({
        code: 'custom',
        path: ['TWO_FACTOR_REQUIRED_ROLES'],
        message: 'must include ADMIN in production (admins sign in with two-factor); a local Docker stack may set ALLOW_ADMIN_WITHOUT_2FA=true',
      });
    }
  })
  .transform((env) => ({
    ...env,
    PAYMENT_SIMULATOR: env.PAYMENT_SIMULATOR ?? env.NODE_ENV !== 'production',
    VNPAY_ENABLED: Boolean(env.VNPAY_TMN_CODE && env.VNPAY_HASH_SECRET),
  }))
  .safeParse(process.env);

if (!parsed.success) {
  // Fail fast: a misconfigured process must not start serving traffic.
  // Only variable names and messages are printed, never values.
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  console.error(`Invalid environment configuration:\n${issues.join('\n')}`);
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && !parsed.data.TWO_FACTOR_REQUIRED_ROLES.includes('ADMIN')) {
  console.warn('WARNING: admins can sign in WITHOUT two-factor (ALLOW_ADMIN_WITHOUT_2FA=true). Never on a real server.');
}

module.exports = Object.freeze(parsed.data);
