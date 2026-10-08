const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const schemas = require('./events.schemas');
const scheduleSchemas = require('./schedules.schemas');
const controller = require('./events.controller');
const schedulesController = require('./schedules.controller');

// ":own" permissions let an organizer act on THEIR events (checked in the
// service); ":any" / approve lets an admin act on all of them.
const canEdit = [authenticate, authorize.any('event:update:own', 'event:manage:any')];
const canChangeStatus = [authenticate, authorize.any('event:update:own', 'event:approve')];
const canManageSchedules = [authenticate, authorize.any('schedule:manage:own', 'event:manage:any')];

/** Mounted at /api/v1/events */
const eventsRouter = Router();

eventsRouter.get('/', authenticate.optional, validate({ query: schemas.listQuery }), controller.list);
eventsRouter.post('/', authenticate, authorize('event:create'), validate({ body: schemas.createEvent }), controller.create);
eventsRouter.get('/:idOrSlug', authenticate.optional, validate({ params: schemas.idOrSlugParams }), controller.get);
eventsRouter.patch('/:id', ...canEdit, validate({ params: schemas.idParams, body: schemas.updateEvent }), controller.update);
eventsRouter.delete('/:id', ...canEdit, validate({ params: schemas.idParams }), controller.remove);
eventsRouter.patch(
  '/:id/status',
  ...canChangeStatus,
  validate({ params: schemas.idParams, body: schemas.changeStatus }),
  controller.changeStatus,
);

eventsRouter.get(
  '/:eventId/schedules',
  authenticate.optional,
  validate({ params: scheduleSchemas.eventIdParams }),
  schedulesController.list,
);
eventsRouter.post(
  '/:eventId/schedules',
  ...canManageSchedules,
  validate({ params: scheduleSchemas.eventIdParams, body: scheduleSchemas.createSchedule }),
  schedulesController.create,
);

/** Mounted at /api/v1/schedules */
const schedulesRouter = Router();

schedulesRouter.patch(
  '/:id',
  ...canManageSchedules,
  validate({ params: scheduleSchemas.idParams, body: scheduleSchemas.updateSchedule }),
  schedulesController.update,
);
schedulesRouter.delete('/:id', ...canManageSchedules, validate({ params: scheduleSchemas.idParams }), schedulesController.remove);

module.exports = { eventsRouter, schedulesRouter };
