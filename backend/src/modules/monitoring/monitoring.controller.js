const { sendSuccess } = require('../../utils/response');
const { collectStatus, series } = require('./system-status');
const { activeAlerts, alertHistory } = require('./alerts');
const { recordClientError, listClientErrors } = require('./client-errors');

const HTTP_ACCEPTED = 202;

/** The page's snapshot: every figure, and the alerts going on now and lately. */
async function status(req, res) {
  const [system, active, history] = await Promise.all([collectStatus(), activeAlerts().catch(() => []), alertHistory().catch(() => [])]);
  return sendSuccess(res, { status: system, alerts: { active, history } });
}

async function getSeries(req, res) {
  return sendSuccess(res, { series: await series(req.valid.query.minutes) });
}

async function getClientErrors(req, res) {
  return sendSuccess(res, { errors: await listClientErrors(req.valid.query.limit) });
}

/** From the web (sendBeacon): nothing to answer but "received". */
async function reportClientError(req, res) {
  await recordClientError(req.valid.body);
  return res.status(HTTP_ACCEPTED).end();
}

module.exports = { status, getSeries, getClientErrors, reportClientError };
