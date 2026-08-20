const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Verifies that an incoming webhook request actually came from Vapi, using
 * an HMAC-SHA256 signature over the raw request body with a shared secret
 * (set as VAPI_WEBHOOK_SECRET here and as the tool server's secret in the
 * Vapi dashboard). Without this, anyone who finds the /webhook URL could
 * call verify_customer, log_promise_to_pay, etc. directly.
 *
 * If VAPI_WEBHOOK_SECRET is unset, this middleware logs a loud warning and
 * allows requests through — so local dev/demo works without extra setup,
 * but a deploy without the secret set is visibly, not silently, insecure.
 */
function verifyVapiSignature(req, res, next) {
  const secret = process.env.VAPI_WEBHOOK_SECRET;

  if (!secret) {
    logger.warn('[security] VAPI_WEBHOOK_SECRET is not set — webhook signature check is DISABLED. Do not run like this in production.');
    return next();
  }

  const signature = req.headers['x-vapi-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing signature header' });
  }

  const expected = crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  const valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

  if (!valid) {
    logger.warn('[security] Rejected webhook request with invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

module.exports = verifyVapiSignature;
