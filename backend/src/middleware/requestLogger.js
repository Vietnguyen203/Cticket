const { randomUUID } = require('node:crypto');
const pinoHttp = require('pino-http');
const logger = require('../utils/logger');

const REQUEST_ID_HEADER = 'x-request-id';
// Accept a caller-supplied id only if it is short and harmless (log injection guard).
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

const SERVER_ERROR_STATUS = 500;
const CLIENT_ERROR_STATUS = 400;

/**
 * Assigns req.id (echoed back as X-Request-Id) and logs one line per request:
 * requestId, method, path, status, latency, userId and errorCode when known.
 */
const requestLogger = pinoHttp({
  logger,
  genReqId(req, res) {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel(req, res, err) {
    if (err || res.statusCode >= SERVER_ERROR_STATUS) return 'error';
    if (res.statusCode >= CLIENT_ERROR_STATUS) return 'warn';
    return 'info';
  },
  // Evaluated when the response finishes, so req.user / res.locals are populated.
  customProps(req, res) {
    return {
      userId: req.user?.id,
      errorCode: res.locals?.errorCode,
    };
  },
  serializers: {
    // Log the path WITHOUT the query string: query strings can carry tokens.
    req: (req) => ({ id: req.id, method: req.method, path: req.url.split('?')[0] }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  // Infrastructure probes would drown the logs.
  autoLogging: { ignore: (req) => req.url.startsWith('/health') },
});

module.exports = requestLogger;
