/**
 * Public API of the purchase queue module (Phase 21), for the orders and
 * events modules and the worker. Its routes are mounted in src/routes.js.
 */
const service = require('./purchase-queue.service');

module.exports = {
  assertTurn: service.assertTurn,
  extendTurn: service.extendTurn,
  extendTurnOfSchedule: service.extendTurnOfSchedule,
  releaseTurnAfterCommit: service.releaseTurnAfterCommit,
  settingsChanged: service.settingsChanged,
  admitQueues: service.admitQueues,
};
