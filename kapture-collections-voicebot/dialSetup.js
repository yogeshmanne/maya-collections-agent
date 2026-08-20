const express = require('express');
const router = express.Router();
const repo = require('../db/callRepository');

// Called by the outbound dialer/scheduler BEFORE the call connects, to fetch
// greeting variables. Deliberately NOT registered as a Vapi tool — the LLM
// never has a path to call this itself. See HLD Section 4 for the rationale.
router.get('/', async (req, res, next) => {
  try {
    const accountRef = req.query.account_id;
    if (!accountRef) {
      return res.status(400).json({ error: 'account_id query parameter is required' });
    }

    const account = await repo.findAccountByRef(accountRef);
    if (!account) {
      return res.status(404).json({ error: 'Unknown account_id' });
    }

    // Deliberately excludes amount_due / days_past_due / loan_type.
    return res.status(200).json({
      account_id: account.account_ref,
      customer_name: account.customer_name,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
