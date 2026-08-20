require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');

const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const verifyVapiSignature = require('./middleware/verifyVapiSignature');

const webhookRoute = require('./routes/webhook');
const dialSetupRoute = require('./routes/dialSetup');
const healthRoute = require('./routes/health');

const app = express();

app.use(helmet());
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

// Rate limit the webhook — a real Vapi deployment sends a bounded number of
// tool calls per call, so a burst well above that is either a bug or abuse.
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });

// Capture the raw body (needed for HMAC signature verification) while still
// parsing JSON for the route handlers.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

app.use('/health', healthRoute);
app.use('/dial-setup', dialSetupRoute);
app.use('/webhook', webhookLimiter, verifyVapiSignature, webhookRoute);

app.use(errorHandler);

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`Kapture collections server listening on port ${PORT}`);
  });
}

module.exports = app;
