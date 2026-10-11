const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const env = require('./config/env');
const requestLogger = require('./middleware/requestLogger');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { rateLimit, LIMITS } = require('./middleware/rateLimit');
const healthRoutes = require('./modules/health/health.routes');
const apiRouter = require('./routes');

const JSON_BODY_LIMIT = '100kb';

/**
 * Build the Express app without listening on a port, so tests can drive it
 * with Supertest and server.js can attach the HTTP (and later WebSocket) server.
 */
function createApp() {
  const app = express();
  // Behind a reverse proxy, req.ip must be the client's address (taken from
  // X-Forwarded-For), not the proxy's, or every user shares one rate limit.
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestLogger);
  app.use(helmet());
  // The React Native app is not a browser and is unaffected by CORS.
  // Only listed web origins (e.g. a future admin dashboard) are allowed.
  app.use(cors({ origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false }));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  // Infrastructure endpoints are deliberately unversioned.
  app.use('/health', healthRoutes);

  app.use('/api/v1', rateLimit(LIMITS.api), apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
