const pino = require('pino');
const env = require('../config/env');

// Anything matching these paths is replaced with "[REDACTED]" before it is written.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.otp',
  '*.qrToken',
];

const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'etp-api' },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  // Human-readable output in development; JSON lines everywhere else.
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' } }
      : undefined,
});

module.exports = logger;
