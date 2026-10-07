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
