const { Router } = require('express');
const authRoutes = require('./modules/auth/auth.routes');
const categoriesRoutes = require('./modules/categories/categories.routes');
const venuesRoutes = require('./modules/venues/venues.routes');
const organizersRoutes = require('./modules/organizers/organizers.routes');
const { eventsRouter, schedulesRouter } = require('./modules/events/events.routes');

/** Everything under /api/v1. Each module mounts its own router here. */
const apiRouter = Router();

apiRouter.use('/auth', authRoutes);
apiRouter.use('/categories', categoriesRoutes);
apiRouter.use('/venues', venuesRoutes);
apiRouter.use('/organizers', organizersRoutes);
apiRouter.use('/events', eventsRouter);
apiRouter.use('/schedules', schedulesRouter);

module.exports = apiRouter;
