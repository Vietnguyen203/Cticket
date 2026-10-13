const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const schemas = require('./reports.schemas');
const controller = require('./reports.controller');

/** Mounted at /api/v1/reports (Phase 12.4). Read only. */
const router = Router();

// REP-01: the organizer of the event or an admin (which events: checked by the service).
router.get(
  '/events/:id/sales',
  authenticate,
  authorize.any('report:read:own', 'report:read:any'),
  validate({ params: schemas.idParams }),
  controller.eventSales,
);
router.get('/my-events', authenticate, authorize('report:read:own'), controller.myEvents);

// REP-02 and the admin dashboard.
router.get('/sales', authenticate, authorize('report:read:any'), validate({ query: schemas.salesQuery }), controller.platformSales);
router.get('/overview', authenticate, authorize('report:read:any'), controller.overview);

module.exports = router;
