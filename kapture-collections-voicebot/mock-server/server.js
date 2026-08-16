const express = require('express');
const app = express();
app.use(express.json());

// --- Mock in-memory "datastore" -------------------------------------------------
const accounts = {
  'ACC-88392': {
    customer_name: 'Rahul Sharma',
    valid_codes: ['1234', '1995'], // last-4 PAN or birth year, either accepted for demo
    loan_type: 'Personal Loan',
    amount_due: 8499,
    dpd: 12
  }
};

const verificationAttempts = {}; // account_id -> count, resets are not persisted across restarts (demo only)

// --- Helper: mask names in logs -------------------------------------------------
function maskName(name) {
  const parts = name.split(' ');
  return parts.map((p, i) => (i === 0 ? p : p[0] + '****')).join(' ');
}

// --- Dialer-side pre-call endpoint (NOT registered as an LLM tool) --------------
// Called by the outbound dialer/scheduler before placing the call, to populate
// Vapi's call variables (customer name for the greeting). Deliberately returns
// no debt figures — those only enter the model's context via verify_customer's
// success response. See HLD Section 4 for why this is kept out of the LLM's tool set.
app.get('/dial-setup', (req, res) => {
  const accountId = req.query.account_id;
  const account = accounts[accountId];

  if (!account) {
    return res.status(404).json({ error: 'Unknown account_id' });
  }

  return res.status(200).json({
    account_id: accountId,
    customer_name: account.customer_name
    // Intentionally no amount_due / dpd / loan_type here.
  });
});

// --- Main Webhook Endpoint for Vapi ---------------------------------------------
app.post('/webhook', (req, res) => {
  const { message } = req.body;

  if (!message || message.type !== 'tool-calls') {
    // Non tool-call Vapi event (status updates, transcripts, etc.) — just acknowledge
    return res.status(200).json({ status: 'acknowledged' });
  }

  const toolCall = message.toolCalls[0];
  const { name, arguments: args } = toolCall.function;
  const callId = toolCall.id;

  console.log(`[Tool Call]: ${name}`, args);

  let result = {};
  const account = accounts[args.account_id];

  switch (name) {
    case 'verify_customer': {
      if (!account) {
        result = { verified: false, message: 'Unknown account.' };
        break;
      }
      verificationAttempts[args.account_id] = (verificationAttempts[args.account_id] || 0) + 1;

      if (account.valid_codes.includes(args.verification_code)) {
        result = {
          verified: true,
          customer_name: account.customer_name,
          message: 'Identity verified successfully.'
        };
      } else {
        result = {
          verified: false,
          attempts_used: verificationAttempts[args.account_id],
          message: 'Verification failed. Incorrect code.'
        };
      }
      break;
    }

    case 'log_promise_to_pay': {
      result = {
        success: true,
        ptp_id: `PTP-${Math.floor(1000 + Math.random() * 9000)}`,
        confirmed_date: args.ptp_date,
        amount: args.amount
      };
      break;
    }

    case 'send_payment_link': {
      result = {
        success: true,
        message: `Payment link sent successfully via ${args.channel} to the registered mobile number.`
      };
      break;
    }

    case 'escalate_to_agent': {
      result = {
        success: true,
        escalation_id: `ESC-${Math.floor(1000 + Math.random() * 9000)}`,
        reason: args.reason,
        queued: true
      };
      break;
    }

    case 'mark_disposition': {
      result = {
        success: true,
        disposition_logged: args.status,
        account_masked: account ? maskName(account.customer_name) : 'UNKNOWN',
        timestamp: new Date().toISOString()
      };
      break;
    }

    default:
      result = { success: false, message: `Unknown function: ${name}` };
  }

  // Response format required by Vapi for tool-call results
  return res.status(200).json({
    results: [
      {
        toolCallId: callId,
        result: JSON.stringify(result)
      }
    ]
  });
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kapture mock collections webhook server running on port ${PORT}`);
});
