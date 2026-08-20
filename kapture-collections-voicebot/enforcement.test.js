const request = require('supertest');
const app = require('../src/server');
const pool = require('../src/db/pool');

function toolCallPayload(vapiCallId, toolCallId, toolName, args) {
  return {
    message: {
      type: 'tool-calls',
      call: { id: vapiCallId },
      toolCalls: [{ id: toolCallId, function: { name: toolName, arguments: args } }],
    },
  };
}

describe('State machine enforcement (server-side, not prompt-dependent)', () => {
  test('log_promise_to_pay is BLOCKED before verify_customer succeeds', async () => {
    const res = await request(app)
      .post('/webhook')
      .send(toolCallPayload('call-1', 'tc1', 'log_promise_to_pay', {
        account_id: 'ACC-88392',
        ptp_date: '2026-08-25',
        amount: 8499,
      }));

    expect(res.status).toBe(200);
    const result = JSON.parse(res.body.results[0].result);
    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_ALLOWED_IN_CURRENT_STATE');

    // And the block is actually persisted to the audit log, not just returned.
    const { rows } = await pool.query(
      `SELECT allowed, block_reason FROM tool_call_logs WHERE tool_name = 'log_promise_to_pay'`
    );
    expect(rows[0].allowed).toBe(false);
    expect(rows[0].block_reason).toMatch(/not permitted in state "INIT"/);
  });

  test('escalate_to_agent is BLOCKED before verification', async () => {
    const res = await request(app)
      .post('/webhook')
      .send(toolCallPayload('call-2', 'tc1', 'escalate_to_agent', {
        account_id: 'ACC-88392',
        reason: 'DISPUTE',
      }));

    const result = JSON.parse(res.body.results[0].result);
    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_ALLOWED_IN_CURRENT_STATE');
  });

  test('send_payment_link is BLOCKED before verification', async () => {
    const res = await request(app)
      .post('/webhook')
      .send(toolCallPayload('call-3', 'tc1', 'send_payment_link', {
        account_id: 'ACC-88392',
        channel: 'SMS',
      }));

    const result = JSON.parse(res.body.results[0].result);
    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_ALLOWED_IN_CURRENT_STATE');
  });

  test('verify_customer with wrong code fails without disclosing debt data', async () => {
    const res = await request(app)
      .post('/webhook')
      .send(toolCallPayload('call-4', 'tc1', 'verify_customer', {
        account_id: 'ACC-88392',
        verification_code: '0000',
      }));

    const result = JSON.parse(res.body.results[0].result);
    expect(result.verified).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/8499|overdue|EMI/i);
  });

  test('verification attempts are capped at 2', async () => {
    const vapiCallId = 'call-5';
    await request(app).post('/webhook').send(
      toolCallPayload(vapiCallId, 'tc1', 'verify_customer', { account_id: 'ACC-88392', verification_code: '0000' })
    );
    await request(app).post('/webhook').send(
      toolCallPayload(vapiCallId, 'tc2', 'verify_customer', { account_id: 'ACC-88392', verification_code: '1111' })
    );
    const thirdAttempt = await request(app).post('/webhook').send(
      toolCallPayload(vapiCallId, 'tc3', 'verify_customer', { account_id: 'ACC-88392', verification_code: '1234' })
    );

    const result = JSON.parse(thirdAttempt.body.results[0].result);
    // Even the CORRECT code on the 3rd attempt must fail — the cap is absolute.
    expect(result.verified).toBe(false);
    expect(result.attempts_exhausted).toBe(true);
  });
});

describe('Happy path: full call lifecycle persists correctly', () => {
  test('verify -> PTP -> payment link -> disposition, in order, on one call', async () => {
    const vapiCallId = 'call-happy';

    const verifyRes = await request(app).post('/webhook').send(
      toolCallPayload(vapiCallId, 'tc1', 'verify_customer', { account_id: 'ACC-88392', verification_code: '1234' })
    );
    expect(JSON.parse(verifyRes.body.results[0].result).verified).toBe(true);

    const ptpRes = await request(app).post('/webhook').send(
      toolCallPayload(vapiCallId, 'tc2', 'log_promise_to_pay', {
        account_id: 'ACC-88392',
        ptp_date: '2026-08-25',
        amount: 8499,
      })
    );
    expect(JSON.parse(ptpRes.body.results[0].result).success).toBe(true);

    const linkRes = await request(app).post('/webhook').send(
      toolCallPayload(vapiCallId, 'tc3', 'send_payment_link', { account_id: 'ACC-88392', channel: 'SMS' })
    );
    const linkResult = JSON.parse(linkRes.body.results[0].result);
    expect(linkResult.success).toBe(true);
    expect(linkResult.dry_run).toBe(true); // no Twilio creds in test env

    const dispositionRes = await request(app).post('/webhook').send(
      toolCallPayload(vapiCallId, 'tc4', 'mark_disposition', {
        account_id: 'ACC-88392',
        status: 'PTP_AGREED',
        notes: 'Customer agreed to pay by Friday',
      })
    );
    expect(JSON.parse(dispositionRes.body.results[0].result).success).toBe(true);

    const { rows } = await pool.query(
      `SELECT c.state, c.disposition, p.amount, p.link_sent
       FROM calls c JOIN promises_to_pay p ON p.call_id = c.id
       WHERE c.vapi_call_id = $1`,
      [vapiCallId]
    );
    expect(rows[0].state).toBe('CALL_ENDED');
    expect(rows[0].disposition).toBe('PTP_AGREED');
    expect(Number(rows[0].amount)).toBe(8499);
    expect(rows[0].link_sent).toBe(true);
  });

  test('already-paid path skips PTP and ends in DISPOSED/CALL_ENDED', async () => {
    const vapiCallId = 'call-already-paid';

    await request(app).post('/webhook').send(
      toolCallPayload(vapiCallId, 'tc1', 'verify_customer', { account_id: 'ACC-88392', verification_code: '1234' })
    );

    const dispositionRes = await request(app).post('/webhook').send(
      toolCallPayload(vapiCallId, 'tc2', 'mark_disposition', {
        account_id: 'ACC-88392',
        status: 'ALREADY_PAID',
        notes: 'Paid via UPI yesterday',
      })
    );
    expect(JSON.parse(dispositionRes.body.results[0].result).success).toBe(true);

    const { rows } = await pool.query(`SELECT state, disposition FROM calls WHERE vapi_call_id = $1`, [vapiCallId]);
    expect(rows[0].state).toBe('CALL_ENDED');
    expect(rows[0].disposition).toBe('ALREADY_PAID');
  });

  test('do-not-call can be logged even before authentication, without debt disclosure', async () => {
    const vapiCallId = 'call-dnc';

    const res = await request(app).post('/webhook').send(
      toolCallPayload(vapiCallId, 'tc1', 'mark_disposition', {
        account_id: 'ACC-88392',
        status: 'DO_NOT_CALL',
      })
    );
    expect(JSON.parse(res.body.results[0].result).success).toBe(true);

    const { rows } = await pool.query(`SELECT state, disposition FROM calls WHERE vapi_call_id = $1`, [vapiCallId]);
    expect(rows[0].disposition).toBe('DO_NOT_CALL');
  });
});

describe('Input validation', () => {
  test('rejects an unknown tool name', async () => {
    const res = await request(app)
      .post('/webhook')
      .send(toolCallPayload('call-x', 'tc1', 'delete_all_debt', { account_id: 'ACC-88392' }));
    expect(res.status).toBe(400);
  });

  test('rejects log_promise_to_pay with a negative amount', async () => {
    const res = await request(app).post('/webhook').send(
      toolCallPayload('call-y', 'tc1', 'log_promise_to_pay', {
        account_id: 'ACC-88392',
        ptp_date: '2026-08-25',
        amount: -500,
      })
    );
    expect(res.status).toBe(400); // caught by errorHandler's ZodError branch
  });
});
