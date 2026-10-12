const { Router } = require('express');
const authRoutes = require('./modules/auth/auth.routes');
const usersRoutes = require('./modules/users/users.routes');
const categoriesRoutes = require('./modules/categories/categories.routes');
const { venuesRouter, zonesRouter, seatsRouter } = require('./modules/venues/venues.routes');
const organizersRoutes = require('./modules/organizers/organizers.routes');
const { eventsRouter, schedulesRouter, ticketTypesRouter, staffRouter } = require('./modules/events/events.routes');
const { ordersRouter, scheduleOrdersRouter } = require('./modules/orders/orders.routes');
const paymentsRoutes = require('./modules/payments/payments.routes');
const promotionsRoutes = require('./modules/promotions/promotions.routes');
const notificationsRoutes = require('./modules/notifications/notifications.routes');
const ticketsRoutes = require('./modules/tickets/tickets.routes');
const { checkInsRouter, scheduleCheckInsRouter } = require('./modules/checkins/checkins.routes');

/** Everything under /api/v1. Each module mounts its own router here. */
const apiRouter = Router();

apiRouter.use('/auth', authRoutes);
apiRouter.use('/users', usersRoutes);
apiRouter.use('/categories', categoriesRoutes);
apiRouter.use('/venues', venuesRouter);
apiRouter.use('/zones', zonesRouter);
apiRouter.use('/seats', seatsRouter);
apiRouter.use('/organizers', organizersRoutes);
apiRouter.use('/events', eventsRouter);
apiRouter.use('/schedules', schedulesRouter);
apiRouter.use('/schedules', scheduleOrdersRouter); // POST /schedules/:id/orders
apiRouter.use('/ticket-types', ticketTypesRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/payments', paymentsRoutes);
apiRouter.use('/promotions', promotionsRoutes);
apiRouter.use('/notifications', notificationsRoutes);
apiRouter.use('/tickets', ticketsRoutes);
apiRouter.use('/check-ins', checkInsRouter);
apiRouter.use('/schedules', scheduleCheckInsRouter); // GET /schedules/:id/check-ins, /check-in-stats
apiRouter.use('/staff', staffRouter);

module.exports = apiRouter;
