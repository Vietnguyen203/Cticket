const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const schemas = require('./events.schemas');
const scheduleSchemas = require('./schedules.schemas');
const inventorySchemas = require('./inventory.schemas');
const controller = require('./events.controller');
const schedulesController = require('./schedules.controller');
const inventoryController = require('./inventory.controller');
const staffSchemas = require('./staff.schemas');
const staffController = require('./staff.controller');

// ":own" permissions let an organizer act on THEIR events (checked in the
// service); ":any" / approve lets an admin act on all of them.
const canEdit = [authenticate, authorize.any('event:update:own', 'event:manage:any')];
const canChangeStatus = [authenticate, authorize.any('event:update:own', 'event:approve')];
const canManageSchedules = [authenticate, authorize.any('schedule:manage:own', 'event:manage:any')];
const canBlockInventory = [authenticate, authorize.any('seat:block:own', 'event:manage:any')];
const canAssignStaff = [authenticate, authorize.any('staff:assign:own', 'event:manage:any')];

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

// Gate staff of an event (Phase 10): the owning organizer or an admin.
eventsRouter.get('/:id/staff', ...canAssignStaff, validate({ params: staffSchemas.eventIdParams }), staffController.list);
eventsRouter.post(
  '/:id/staff',
  ...canAssignStaff,
  validate({ params: staffSchemas.eventIdParams, body: staffSchemas.assignStaff }),
  staffController.assign,
);
eventsRouter.delete('/:id/staff/:userId', ...canAssignStaff, validate({ params: staffSchemas.staffParams }), staffController.remove);

/** Mounted at /api/v1/staff: the gate staff's own view (APP-S01). */
const staffRouter = Router();

staffRouter.get('/events', authenticate, authorize('checkin:read'), staffController.myEvents);

/** Mounted at /api/v1/schedules */
const schedulesRouter = Router();

schedulesRouter.patch(
  '/:id',
  ...canManageSchedules,
  validate({ params: scheduleSchemas.idParams, body: scheduleSchemas.updateSchedule }),
  schedulesController.update,
);
schedulesRouter.delete('/:id', ...canManageSchedules, validate({ params: scheduleSchemas.idParams }), schedulesController.remove);

// Sales configuration of a schedule (DRAFT event): ticket types and seat plan.
const scheduleParams = { params: inventorySchemas.idParams };
schedulesRouter.get('/:id/ticket-types', authenticate.optional, validate(scheduleParams), inventoryController.listTicketTypes);
schedulesRouter.post(
  '/:id/ticket-types',
  ...canManageSchedules,
  validate({ ...scheduleParams, body: inventorySchemas.createTicketType }),
  inventoryController.createTicketType,
);
schedulesRouter.get('/:id/seat-plan', ...canManageSchedules, validate(scheduleParams), inventoryController.getSeatPlan);
schedulesRouter.put(
  '/:id/seat-plan',
  ...canManageSchedules,
  validate({ ...scheduleParams, body: inventorySchemas.seatPlan }),
  inventoryController.replaceSeatPlan,
);

// Inventory (generated when the event is approved).
schedulesRouter.get('/:id/availability', authenticate.optional, validate(scheduleParams), inventoryController.getAvailability);
schedulesRouter.get('/:id/seat-map', authenticate.optional, validate(scheduleParams), inventoryController.getSeatMap);
schedulesRouter.post(
  '/:id/inventory/block',
  ...canBlockInventory,
  validate({ ...scheduleParams, body: inventorySchemas.blockInventory }),
  inventoryController.changeBlocks,
);
schedulesRouter.post(
  '/:id/inventory/generate',
  authenticate,
  authorize('event:manage:any'),
  validate(scheduleParams),
  inventoryController.regenerateInventory,
);

/** Mounted at /api/v1/ticket-types */
const ticketTypesRouter = Router();

ticketTypesRouter.patch(
  '/:id',
  ...canManageSchedules,
  validate({ params: inventorySchemas.idParams, body: inventorySchemas.updateTicketType }),
  inventoryController.updateTicketType,
);
ticketTypesRouter.delete(
  '/:id',
  ...canManageSchedules,
  validate({ params: inventorySchemas.idParams }),
  inventoryController.deleteTicketType,
);

module.exports = { eventsRouter, schedulesRouter, ticketTypesRouter, staffRouter };
