const cuid = require('cuid');
const pool = require('./pool');

async function findAccountByRef(accountRef) {
  const { rows } = await pool.query('SELECT * FROM accounts WHERE account_ref = $1', [accountRef]);
  return rows[0] || null;
}

async function createCall(accountId) {
  const id = cuid();
  const { rows } = await pool.query(
    `INSERT INTO calls (id, account_id, state) VALUES ($1, $2, 'INIT') RETURNING *`,
    [id, accountId]
  );
  return rows[0];
}

async function findCallById(callId) {
  const { rows } = await pool.query('SELECT * FROM calls WHERE id = $1', [callId]);
  return rows[0] || null;
}

async function findOrCreateCallForVapiCallId(vapiCallId, accountRef) {
  const existing = await pool.query('SELECT * FROM calls WHERE vapi_call_id = $1', [vapiCallId]);
  if (existing.rows[0]) return existing.rows[0];

  const account = await findAccountByRef(accountRef);
  if (!account) throw new Error(`Unknown account_ref: ${accountRef}`);

  const id = cuid();
  const { rows } = await pool.query(
    `INSERT INTO calls (id, account_id, vapi_call_id, state) VALUES ($1, $2, $3, 'INIT') RETURNING *`,
    [id, account.id, vapiCallId]
  );
  return rows[0];
}

async function updateCallState(callId, newState, extra = {}) {
  const fields = ['state = $2'];
  const values = [callId, newState];
  let idx = 3;

  if (extra.verifiedAt !== undefined) {
    fields.push(`verified_at = $${idx++}`);
    values.push(extra.verifiedAt);
  }
  if (extra.incrementVerificationAttempts) {
    fields.push('verification_attempts = verification_attempts + 1');
  }
  if (extra.disposition !== undefined) {
    fields.push(`disposition = $${idx++}`);
    values.push(extra.disposition);
  }
  if (extra.dispositionNotes !== undefined) {
    fields.push(`disposition_notes = $${idx++}`);
    values.push(extra.dispositionNotes);
  }
  if (extra.ended) {
    fields.push('ended_at = now()');
  }

  const { rows } = await pool.query(
    `UPDATE calls SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  return rows[0];
}

async function incrementVerificationAttempts(callId) {
  const { rows } = await pool.query(
    `UPDATE calls SET verification_attempts = verification_attempts + 1 WHERE id = $1 RETURNING *`,
    [callId]
  );
  return rows[0];
}

async function logToolCall(callId, { toolName, argsJson, allowed, blockReason, resultJson }) {
  const id = cuid();
  await pool.query(
    `INSERT INTO tool_call_logs (id, call_id, tool_name, args_json, allowed, block_reason, result_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, callId, toolName, argsJson, allowed, blockReason || null, resultJson || null]
  );
}

async function savePromiseToPay(callId, { ptpDate, amount }) {
  const id = cuid();
  const { rows } = await pool.query(
    `INSERT INTO promises_to_pay (id, call_id, ptp_date, amount) VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, callId, ptpDate, amount]
  );
  return rows[0];
}

async function markPaymentLinkSent(callId, channel) {
  await pool.query(
    `UPDATE promises_to_pay SET link_sent = true, link_channel = $2 WHERE call_id = $1`,
    [callId, channel]
  );
}

async function saveEscalation(callId, { reason, notes }) {
  const id = cuid();
  const { rows } = await pool.query(
    `INSERT INTO escalations (id, call_id, reason, notes) VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, callId, reason, notes || null]
  );
  return rows[0];
}

module.exports = {
  findAccountByRef,
  createCall,
  findCallById,
  findOrCreateCallForVapiCallId,
  updateCallState,
  incrementVerificationAttempts,
  logToolCall,
  savePromiseToPay,
  markPaymentLinkSent,
  saveEscalation,
};
