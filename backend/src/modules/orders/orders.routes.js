const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const { rateLimit, LIMITS } = require('../../middleware/rateLimit');
const schemas = require('./orders.schemas');
const controller = require('./orders.controller');

// ":own" covers the caller's orders (checked in the service); order:manage covers all.
const canRead = [authenticate, authorize.any('order:read:own', 'order:manage')];
const canCancel = [authenticate, authorize.any('order:cancel:own', 'order:manage')];

/** Mounted at /api/v1/orders */
const ordersRouter = Router();

ordersRouter.get('/', ...canRead, validate({ query: schemas.listQuery }), controller.list);
ordersRouter.get('/:id', ...canRead, validate({ params: schemas.idParams }), controller.get);
ordersRouter.post('/:id/cancel', ...canCancel, validate({ params: schemas.idParams }), controller.cancel);
// ORD-03: only the buyer checks out their own order (checked in the service).
ordersRouter.post(
  '/:id/checkout',
  authenticate,
  authorize('booking:create'),
  validate({ params: schemas.idParams, body: schemas.checkout }),
  controller.checkout,
);
// BKG-02: the buyer changes the seats / tickets of their HELD order (checked in the service).
const canEdit = [authenticate, rateLimit(LIMITS.orderEdit), authorize('booking:create')];
ordersRouter.put(
  '/:id/items',
  ...canEdit,
  validate({ params: schemas.idParams, body: schemas.updateItems }),
  controller.updateItems,
);
ordersRouter.delete('/:id/seats/:seatId', ...canEdit, validate({ params: schemas.seatParams }), controller.removeSeat);

/** Mounted at /api/v1/schedules (next to the events module's schedule routes). */
const scheduleOrdersRouter = Router();

scheduleOrdersRouter.post(
  '/:id/orders',
  authenticate,
  rateLimit(LIMITS.booking), // per user: stops bots hammering the booking endpoint
  authorize('booking:create'),
  validate({ params: schemas.idParams, body: schemas.createOrder }),
  controller.create,
);

module.exports = { ordersRouter, scheduleOrdersRouter };
