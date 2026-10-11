const { checkDatabase } = require('../../database/pool');
const { checkRedis } = require('../../redis/client');
const AppError = require('../../utils/AppError');
const { sendSuccess } = require('../../utils/response');

/** Liveness: the process is up and the event loop responds. No dependencies checked. */
function live(req, res) {
  return sendSuccess(res, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
}

/**
 * Readiness: the process can actually serve traffic.
 * PostgreSQL is required. Redis is not: without it the API runs slower
 * (no cache) and only OTP requests fail, so it reports "degraded" with 200
 * instead of being taken out of the load balancer.
 */
async function ready(req, res) {
  try {
    await checkDatabase();
  } catch (err) {
    req.log.warn({ err }, 'Readiness check failed: database unreachable');
    throw new AppError('SERVICE_UNAVAILABLE', undefined, { details: { database: 'down' } });
  }

  let redis = 'up';
  try {
    await checkRedis();
  } catch (err) {
    req.log.warn({ err }, 'Readiness check: Redis unreachable');
    redis = 'down';
  }
  return sendSuccess(res, {
    status: redis === 'up' ? 'ok' : 'degraded',
    checks: { database: 'up', redis },
  });
}

module.exports = { live, ready };
