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
 * with Supertest and server.js can attach the HTTP server and the WebSocket hub.
 */
function createApp() {
  const app = express();
  // Behind a reverse proxy, req.ip must be the client's address (taken from
  // X-Forwarded-For), not the proxy's, or every user shares one rate limit.
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestLogger);
  app.use(helmet());
  // The web app is served from the same origin as the API (Vite / nginx proxy),
  // so CORS is only for other listed origins; clients that are not browsers
  // (Postman, k6) are unaffected by it.
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
