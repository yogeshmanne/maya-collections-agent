const { z } = require('zod');

const toolSchemas = {
  verify_customer: z.object({
    account_id: z.string().min(1),
    verification_code: z.string().min(2).max(20),
  }),
  log_promise_to_pay: z.object({
    account_id: z.string().min(1),
    ptp_date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'ptp_date must be a valid date'),
    amount: z.number().positive(),
  }),
  send_payment_link: z.object({
    account_id: z.string().min(1),
    channel: z.enum(['SMS', 'WhatsApp', 'BOTH']),
  }),
  escalate_to_agent: z.object({
    account_id: z.string().min(1),
    reason: z.enum(['HARDSHIP_REQUEST', 'DISPUTE', 'ABUSIVE_UNRESOLVED', 'OTHER']),
    notes: z.string().optional(),
  }),
  mark_disposition: z.object({
    account_id: z.string().min(1),
    status: z.enum([
      'PTP_AGREED',
      'ALREADY_PAID',
      'DISPUTED',
      'HARDSHIP_ESCALATED',
      'WRONG_PERSON',
      'DO_NOT_CALL',
      'NO_RESPONSE',
      'ABUSIVE',
      'VERIFICATION_FAILED',
      'CALLBACK_REQUESTED',
    ]),
    notes: z.string().optional(),
  }),
};

module.exports = toolSchemas;
