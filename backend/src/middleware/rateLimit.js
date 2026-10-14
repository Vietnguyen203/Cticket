const env = require('../config/env');
const AppError = require('../utils/AppError');
const { redis, tryRedis } = require('../redis/client');

const MS_PER_SECOND = 1000;

// Switched off in the general test suite (hundreds of requests from
// 127.0.0.1); the rate limit tests turn it back on.
const settings = { enabled: env.RATE_LIMIT_ENABLED };

/**
 * Fixed-window rate limit backed by Redis, so every API instance shares the
 * same counters. One atomic Lua call per request (INCR + TTL).
 *
 *   router.post('/login', rateLimit({ name: 'login', limit: 5, windowSeconds: 60 }), ...)
 *
 * - `key(req)` decides who is counted (default: client IP; e.g. the user id
 *   for booking). Returning null skips the limit for that request.
 * - Over the limit → 429 RATE_LIMITED with Retry-After.
 * - Redis down → the request is let through (logged): refusing all traffic
 *   because the limiter is unavailable would be worse.
 */
function rateLimit({ name, limit, windowSeconds, key = (req) => req.ip }) {
  const windowMs = windowSeconds * MS_PER_SECOND;

  return async function rateLimitMiddleware(req, res, next) {
    const who = settings.enabled ? key(req) : null;
    if (!who) return next();

    const hit = await tryRedis(`rate limit ${name}`, () => redis.rateLimitHit(`rl:${name}:${who}`, windowMs), null);
    if (!hit) return next();

    const [count, ttlMs] = hit;
    const resetSeconds = Math.max(1, Math.ceil(ttlMs / MS_PER_SECOND));
    res.set({
      'RateLimit-Limit': String(limit),
      'RateLimit-Remaining': String(Math.max(0, limit - count)),
      'RateLimit-Reset': String(resetSeconds),
    });
    if (count > limit) {
      res.set('Retry-After', String(resetSeconds));
      throw new AppError('RATE_LIMITED', undefined, { details: { retryAfterSeconds: resetSeconds } });
    }
    return next();
  };
}

/** Limits per route (see docs/phase-6-redis-design.md, section 5). */
const LIMITS = Object.freeze({
  api: { name: 'api', limit: 600, windowSeconds: 60 },
  login: { name: 'login', limit: 5, windowSeconds: 60 },
  // The code step of a login, per IP (each sign-in step also allows only 5 wrong codes).
  loginTwoFactor: { name: 'login-2fa', limit: 10, windowSeconds: 60 },
  // Two-factor settings of a signed-in user (password / code checks).
  twoFactor: { name: '2fa', limit: 10, windowSeconds: 60, key: (req) => req.user?.id },
  register: { name: 'register', limit: 10, windowSeconds: 3600 },
  otpRequest: { name: 'otp', limit: 10, windowSeconds: 3600 },
  otpVerify: { name: 'otp-verify', limit: 30, windowSeconds: 900 },
  refresh: { name: 'refresh', limit: 60, windowSeconds: 60 },
  booking: { name: 'booking', limit: 10, windowSeconds: 60, key: (req) => req.user?.id },
  orderEdit: { name: 'order-edit', limit: 30, windowSeconds: 60, key: (req) => req.user?.id },
  upload: { name: 'upload', limit: 30, windowSeconds: 3600, key: (req) => req.user?.id },
});

/** For tests only. */
function setRateLimitEnabled(enabled) {
  settings.enabled = enabled;
}

module.exports = { rateLimit, LIMITS, setRateLimitEnabled };
