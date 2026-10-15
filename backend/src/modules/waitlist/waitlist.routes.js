const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const schemas = require('./waitlist.schemas');
const controller = require('./waitlist.controller');

/** Phase 18.4. Joining is for buyers (payment:create): the ones who can book. */
const buyer = [authenticate, authorize('payment:create')];

/** Mounted at /api/v1/waitlist: my entries. */
const waitlistRouter = Router();
waitlistRouter.get('/', ...buyer, controller.listMine);
waitlistRouter.delete('/:id', ...buyer, validate({ params: schemas.idParams }), controller.leave);

/** Mounted at /api/v1/schedules: POST /schedules/:id/waitlist. */
const scheduleWaitlistRouter = Router();
scheduleWaitlistRouter.post('/:id/waitlist', ...buyer, validate({ params: schemas.idParams, body: schemas.join }), controller.join);

module.exports = { waitlistRouter, scheduleWaitlistRouter };
