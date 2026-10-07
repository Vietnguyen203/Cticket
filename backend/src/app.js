const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const env = require('./config/env');
const requestLogger = require('./middleware/requestLogger');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const healthRoutes = require('./modules/health/health.routes');

const JSON_BODY_LIMIT = '100kb';

/**
 * Build the Express app without listening on a port, so tests can drive it
 * with Supertest and server.js can attach the HTTP (and later WebSocket) server.
 */
function createApp() {
  const app = express();

  app.use(requestLogger);
  app.use(helmet());
  // The React Native app is not a browser and is unaffected by CORS.
  // Only listed web origins (e.g. a future admin dashboard) are allowed.
  app.use(cors({ origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false }));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  // Infrastructure endpoints are deliberately unversioned.
  app.use('/health', healthRoutes);

  // Versioned API routes are mounted here from Phase 2 on:
  // app.use('/api/v1', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
