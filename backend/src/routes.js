const { Router } = require('express');
const authRoutes = require('./modules/auth/auth.routes');
const categoriesRoutes = require('./modules/categories/categories.routes');
const { venuesRouter, zonesRouter, seatsRouter } = require('./modules/venues/venues.routes');
const organizersRoutes = require('./modules/organizers/organizers.routes');
const { eventsRouter, schedulesRouter, ticketTypesRouter } = require('./modules/events/events.routes');

/** Everything under /api/v1. Each module mounts its own router here. */
const apiRouter = Router();

apiRouter.use('/auth', authRoutes);
apiRouter.use('/categories', categoriesRoutes);
apiRouter.use('/venues', venuesRouter);
apiRouter.use('/zones', zonesRouter);
apiRouter.use('/seats', seatsRouter);
apiRouter.use('/organizers', organizersRoutes);
apiRouter.use('/events', eventsRouter);
apiRouter.use('/schedules', schedulesRouter);
apiRouter.use('/ticket-types', ticketTypesRouter);

module.exports = apiRouter;
