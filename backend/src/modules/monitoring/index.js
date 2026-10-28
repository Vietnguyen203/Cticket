/** Phase 23: system monitoring (docs/phase-23-monitoring-design.md). */
const { metricsMiddleware, startMetricsFlush, reportConnections } = require('./metrics');
const { startAlertLoop } = require('./alerts');

module.exports = { metricsMiddleware, startMetricsFlush, reportConnections, startAlertLoop };
