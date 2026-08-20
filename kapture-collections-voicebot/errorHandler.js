const logger = require('../utils/logger');
const { StateMachineViolation } = require('../state-machine/callStateMachine');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof StateMachineViolation) {
    logger.warn({ err: err.message, meta: err.meta }, 'Blocked tool call: state machine violation');
    return res.status(409).json({ error: err.message, code: 'STATE_MACHINE_VIOLATION' });
  }

  if (err.name === 'ZodError') {
    return res.status(400).json({ error: 'Invalid request payload', details: err.errors });
  }

  logger.error({ err }, 'Unhandled error');
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;
