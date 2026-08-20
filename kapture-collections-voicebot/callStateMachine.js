/**
 * Server-enforced conversation state machine.
 *
 * This is the piece that turns "the LLM shouldn't disclose debt before
 * verification" from a prompt instruction into a structural guarantee.
 * Every tool handler calls `assertTransition` (or `assertState`) BEFORE
 * doing anything else. If the call's current state (read from Postgres,
 * not trusted from the request) doesn't permit the requested tool, the
 * handler rejects it — regardless of what the model sends.
 *
 * This means: even if the system prompt were sloppy, or the model were
 * successfully jailbroken into attempting a premature disclosure or a
 * skipped-verification PTP log, the tool call itself fails at the data
 * layer. The prompt (vapi/system_prompt.txt) is what keeps the CONVERSATION
 * on the happy path; this module is what keeps the SYSTEM safe if it isn't.
 */

const STATES = [
  'INIT',
  'AUTH_PENDING',
  'AUTHENTICATED',
  'NEGOTIATION',
  'PTP_COLLECTED',
  'ESCALATED',
  'DISPOSED',
  'CALL_ENDED',
];

// Which tool is allowed to run in which state(s).
// This table is the actual enforcement — not the system prompt's prose.
const TOOL_STATE_REQUIREMENTS = {
  verify_customer: ['INIT', 'AUTH_PENDING'],
  log_promise_to_pay: ['AUTHENTICATED', 'NEGOTIATION'],
  send_payment_link: ['AUTHENTICATED', 'NEGOTIATION', 'PTP_COLLECTED'],
  escalate_to_agent: ['AUTHENTICATED', 'NEGOTIATION'],
  mark_disposition: ['AUTHENTICATED', 'NEGOTIATION', 'PTP_COLLECTED', 'ESCALATED', 'DISPOSED', 'INIT', 'AUTH_PENDING'],
};

// Which state a tool's SUCCESS moves the call into.
const TOOL_SUCCESS_TRANSITION = {
  verify_customer: 'AUTHENTICATED',
  log_promise_to_pay: 'PTP_COLLECTED',
  escalate_to_agent: 'ESCALATED',
  // send_payment_link doesn't change state on its own — it's a side effect
  // within NEGOTIATION/PTP_COLLECTED.
};

class StateMachineViolation extends Error {
  constructor(message, meta) {
    super(message);
    this.name = 'StateMachineViolation';
    this.meta = meta;
  }
}

/**
 * Throws StateMachineViolation if `toolName` is not permitted while the
 * call is in `currentState`. Callers MUST call this before executing any
 * tool's business logic and before touching any sensitive data.
 */
function assertToolAllowed(toolName, currentState) {
  const allowedStates = TOOL_STATE_REQUIREMENTS[toolName];
  if (!allowedStates) {
    throw new StateMachineViolation(`Unknown tool: ${toolName}`, { toolName, currentState });
  }
  if (!allowedStates.includes(currentState)) {
    throw new StateMachineViolation(
      `Tool "${toolName}" is not permitted in state "${currentState}". Allowed: ${allowedStates.join(', ')}`,
      { toolName, currentState, allowedStates }
    );
  }
}

/** Returns the state a successful call to `toolName` should transition to, or null if unchanged. */
function nextStateOnSuccess(toolName) {
  return TOOL_SUCCESS_TRANSITION[toolName] || null;
}

module.exports = {
  STATES,
  TOOL_STATE_REQUIREMENTS,
  StateMachineViolation,
  assertToolAllowed,
  nextStateOnSuccess,
};
