const logger = require('../utils/logger');

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
const isConfigured = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);

let client = null;
if (isConfigured) {
  // Real Twilio SDK — only instantiated when real credentials are present.
  const twilio = require('twilio');
  client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

/**
 * Sends a payment-link message via SMS or WhatsApp.
 * - With real Twilio credentials in .env: sends for real via the Twilio API.
 * - Without them: dry-run mode — logs what would have been sent and returns
 *   success, so the rest of the flow (and the demo) works end-to-end without
 *   requiring a Twilio account.
 *
 * This is a deliberate config-presence switch, not a mock that pretends to
 * be real — swap in credentials and it starts actually sending.
 */
async function sendPaymentLink({ toPhoneNumber, channel, paymentUrl, accountRef }) {
  const body = `Kapture Finance: Your payment link for account ${accountRef} is ${paymentUrl}. Reply STOP to opt out.`;

  if (!isConfigured) {
    logger.warn(
      { toPhoneNumber, channel, accountRef },
      '[twilio] DRY RUN — no TWILIO_* credentials set. Would have sent this message.'
    );
    return { sent: true, dryRun: true, sid: null };
  }

  const to = channel === 'WhatsApp' ? `whatsapp:${toPhoneNumber}` : toPhoneNumber;
  const from = channel === 'WhatsApp' ? `whatsapp:${TWILIO_FROM_NUMBER}` : TWILIO_FROM_NUMBER;

  const message = await client.messages.create({ to, from, body });
  logger.info({ sid: message.sid, channel, accountRef }, '[twilio] message sent');
  return { sent: true, dryRun: false, sid: message.sid };
}

module.exports = { sendPaymentLink, isConfigured };
