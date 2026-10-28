const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const { rateLimit, LIMITS } = require('../../middleware/rateLimit');
const schemas = require('./monitoring.schemas');
const controller = require('./monitoring.controller');

/** Phase 23, mounted at /api/v1/admin/system: the "Tình trạng hệ thống" page. */
const systemRouter = Router();
const canMonitor = [authenticate, authorize('system:monitor')];
systemRouter.get('/', ...canMonitor, controller.status);
systemRouter.get('/series', ...canMonitor, validate({ query: schemas.seriesQuery }), controller.getSeries);
systemRouter.get('/client-errors', ...canMonitor, validate({ query: schemas.clientErrorsQuery }), controller.getClientErrors);

/**
 * Mounted at /api/v1/client-errors: JavaScript errors from the web. No login
 * (an error may happen before it), limited per IP; nothing personal is kept.
 */
const clientErrorsRouter = Router();
clientErrorsRouter.post('/', rateLimit(LIMITS.clientErrors), validate({ body: schemas.clientError }), controller.reportClientError);

module.exports = { systemRouter, clientErrorsRouter };
