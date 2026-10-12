const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const schemas = require('./checkins.schemas');
const controller = require('./checkins.controller');

/** Mounted at /api/v1/check-ins: gate staff scanning tickets (CHK-01). */
const checkInsRouter = Router();

checkInsRouter.post('/', authenticate, authorize('checkin:create'), validate({ body: schemas.checkIn }), controller.create);

/**
 * Mounted at /api/v1/schedules (CHK-02, CHK-03): the event's staff
 * (checkin:read), its organizer (report:read:own) or an admin. Which
 * schedules each one may follow is checked by the service.
 */
const scheduleCheckInsRouter = Router();
const canFollow = [authenticate, authorize.any('checkin:read', 'report:read:own', 'event:manage:any')];

scheduleCheckInsRouter.get(
  '/:id/check-ins',
  ...canFollow,
  validate({ params: schemas.idParams, query: schemas.listQuery }),
  controller.list,
);
scheduleCheckInsRouter.get('/:id/check-in-stats', ...canFollow, validate({ params: schemas.idParams }), controller.stats);

module.exports = { checkInsRouter, scheduleCheckInsRouter };
