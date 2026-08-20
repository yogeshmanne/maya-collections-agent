const repo = require('../db/callRepository');
const kyc = require('../integrations/kyc');
const twilioIntegration = require('../integrations/twilio');
const { assertToolAllowed, nextStateOnSuccess, StateMachineViolation } = require('../state-machine/callStateMachine');
const { maskArgsForLogging } = require('../utils/mask');
const logger = require('../utils/logger');

const MAX_VERIFICATION_ATTEMPTS = 2;

/**
 * Central dispatcher for all Vapi tool calls. This is where the server-side
 * guarantee actually lives: every branch below runs assertToolAllowed()
 * against the call's CURRENT STATE AS STORED IN POSTGRES before doing any
 * business logic. The LLM's belief about what state the conversation is in
 * is irrelevant here — only the database row is trusted.
 */
async function handleToolCall({ toolName, args, vapiCallId, accountRef }) {
  const call = await repo.findOrCreateCallForVapiCallId(vapiCallId, accountRef);

  let allowed = true;
  let blockReason = null;
  let result;

  try {
    assertToolAllowed(toolName, call.state);
  } catch (err) {
    if (err instanceof StateMachineViolation) {
      allowed = false;
      blockReason = err.message;
    } else {
      throw err;
    }
  }

  if (!allowed) {
    await repo.logToolCall(call.id, {
      toolName,
      argsJson: JSON.stringify(maskArgsForLogging(args)),
      allowed: false,
      blockReason,
    });
    // Re-throw so the route layer returns a clean 409 to Vapi. The tool
    // simply fails from the LLM's point of view — it gets no debt data,
    // no success confirmation, nothing to work with.
    const violation = new StateMachineViolation(blockReason, { toolName, state: call.state });
    throw violation;
  }

  switch (toolName) {
    case 'verify_customer':
      result = await handleVerifyCustomer(call, args);
      break;
    case 'log_promise_to_pay':
      result = await handleLogPromiseToPay(call, args);
      break;
    case 'send_payment_link':
      result = await handleSendPaymentLink(call, args);
      break;
    case 'escalate_to_agent':
      result = await handleEscalateToAgent(call, args);
      break;
    case 'mark_disposition':
      result = await handleMarkDisposition(call, args);
      break;
    default:
      throw new Error(`Unhandled tool: ${toolName}`);
  }

  await repo.logToolCall(call.id, {
    toolName,
    argsJson: JSON.stringify(maskArgsForLogging(args)),
    allowed: true,
    resultJson: JSON.stringify(result),
  });

  return result;
}

async function handleVerifyCustomer(call, args) {
  const account = await repo.findAccountByRef(args.account_id);
  if (!account) {
    return { verified: false, message: 'Unknown account.' };
  }

  if (call.verification_attempts >= MAX_VERIFICATION_ATTEMPTS) {
    return { verified: false, message: 'Maximum verification attempts exceeded.', attempts_exhausted: true };
  }

  const { verified } = await kyc.verifyCode({ account, submittedCode: args.verification_code });
  await repo.incrementVerificationAttempts(call.id);

  if (verified) {
    await repo.updateCallState(call.id, 'AUTHENTICATED', { verifiedAt: new Date() });
    return { verified: true, customer_name: account.customer_name, message: 'Identity verified successfully.' };
  }

  const attemptsNow = call.verification_attempts + 1;
  logger.info({ callId: call.id, attemptsNow }, 'verify_customer: no match');
  return {
    verified: false,
    attempts_used: attemptsNow,
    attempts_exhausted: attemptsNow >= MAX_VERIFICATION_ATTEMPTS,
    message: 'Verification failed. Incorrect code.',
  };
}

async function handleLogPromiseToPay(call, args) {
  const account = await repo.findAccountByRef(args.account_id);
  if (!account) throw new Error('Unknown account.');

  await repo.savePromiseToPay(call.id, { ptpDate: args.ptp_date, amount: args.amount });
  await repo.updateCallState(call.id, nextStateOnSuccess('log_promise_to_pay'));

  return {
    success: true,
    ptp_id: `PTP-${call.id.slice(-6).toUpperCase()}`,
    confirmed_date: args.ptp_date,
    amount: args.amount,
  };
}

async function handleSendPaymentLink(call, args) {
  const account = await repo.findAccountByRef(args.account_id);
  if (!account) throw new Error('Unknown account.');

  // In production this would look up the customer's registered phone
  // number from the account/LMS record. Using a placeholder here since
  // the mock accounts table doesn't carry a phone field.
  const toPhoneNumber = account.phone_number || '+910000000000';
  const paymentUrl = `https://pay.kapturefinance.example/${account.account_ref}`;

  const sendResult = await twilioIntegration.sendPaymentLink({
    toPhoneNumber,
    channel: args.channel,
    paymentUrl,
    accountRef: args.account_id,
  });

  await repo.markPaymentLinkSent(call.id, args.channel);

  return {
    success: true,
    dry_run: sendResult.dryRun,
    message: sendResult.dryRun
      ? `[DRY RUN] No Twilio credentials configured — would have sent via ${args.channel}.`
      : `Payment link sent successfully via ${args.channel}.`,
  };
}

async function handleEscalateToAgent(call, args) {
  await repo.saveEscalation(call.id, { reason: args.reason, notes: args.notes });
  await repo.updateCallState(call.id, nextStateOnSuccess('escalate_to_agent'));

  return {
    success: true,
    escalation_id: `ESC-${call.id.slice(-6).toUpperCase()}`,
    reason: args.reason,
    queued: true,
  };
}

async function handleMarkDisposition(call, args) {
  const terminalStatuses = new Set([
    'ALREADY_PAID', 'DISPUTED', 'WRONG_PERSON', 'DO_NOT_CALL',
    'NO_RESPONSE', 'ABUSIVE', 'VERIFICATION_FAILED', 'CALLBACK_REQUESTED',
  ]);
  const newState = args.status === 'PTP_AGREED' ? 'PTP_COLLECTED'
    : args.status === 'HARDSHIP_ESCALATED' ? 'ESCALATED'
    : terminalStatuses.has(args.status) ? 'DISPOSED'
    : call.state;

  await repo.updateCallState(call.id, newState, {
    disposition: args.status,
    dispositionNotes: args.notes || null,
    ended: true,
  });
  await repo.updateCallState(call.id, 'CALL_ENDED');

  return {
    success: true,
    disposition_logged: args.status,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { handleToolCall, MAX_VERIFICATION_ATTEMPTS };
