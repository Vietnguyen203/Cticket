const { Router } = require('express');
const authRoutes = require('./modules/auth/auth.routes');

/** Everything under /api/v1. Each module mounts its own router here. */
const apiRouter = Router();

apiRouter.use('/auth', authRoutes);

module.exports = apiRouter;
