const { checkDatabase } = require('../../database/pool');
const AppError = require('../../utils/AppError');
const { sendSuccess } = require('../../utils/response');

/** Liveness: the process is up and the event loop responds. No dependencies checked. */
function live(req, res) {
  return sendSuccess(res, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
}

/** Readiness: the process can actually serve traffic (dependencies reachable). */
async function ready(req, res) {
  try {
    await checkDatabase();
  } catch (err) {
    req.log.warn({ err }, 'Readiness check failed: database unreachable');
    throw new AppError('SERVICE_UNAVAILABLE', undefined, { details: { database: 'down' } });
  }
  return sendSuccess(res, { status: 'ok', checks: { database: 'up' } });
}

module.exports = { live, ready };
