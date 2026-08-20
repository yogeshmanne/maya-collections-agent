const pino = require('pino');

// Structured logging (JSON in prod, pretty in dev). Any PII passed into
// log calls should already be masked by utils/mask.js before it gets here —
// this logger doesn't do masking itself, it just formats.
const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});

module.exports = logger;
