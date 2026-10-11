const { Router } = require('express');
const authRoutes = require('./modules/auth/auth.routes');
const usersRoutes = require('./modules/users/users.routes');
const categoriesRoutes = require('./modules/categories/categories.routes');
const { venuesRouter, zonesRouter, seatsRouter } = require('./modules/venues/venues.routes');
const organizersRoutes = require('./modules/organizers/organizers.routes');
const { eventsRouter, schedulesRouter, ticketTypesRouter } = require('./modules/events/events.routes');
const { ordersRouter, scheduleOrdersRouter } = require('./modules/orders/orders.routes');

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

module.exports = apiRouter;
