const express = require('express');
const router = express.Router();

const toolSchemas = require('../services/toolSchemas');
const { handleToolCall } = require('../services/toolCallService');
const { StateMachineViolation } = require('../state-machine/callStateMachine');
const logger = require('../utils/logger');
const { maskArgsForLogging } = require('../utils/mask');

router.post('/', async (req, res, next) => {
  try {
    const { message } = req.body;

    if (!message || message.type !== 'tool-calls') {
      // Non tool-call Vapi lifecycle events (status updates, transcripts, end-of-call-report, etc.)
      return res.status(200).json({ status: 'acknowledged' });
    }

    const toolCall = message.toolCalls?.[0];
    if (!toolCall) {
      return res.status(400).json({ error: 'No toolCalls present in payload' });
    }

    const { name: toolName, arguments: rawArgs } = toolCall.function;
    const callId = toolCall.id;
    const vapiCallId = message.call?.id || req.body.call?.id || 'unknown-call';

    const schema = toolSchemas[toolName];
    if (!schema) {
      return res.status(400).json({ error: `Unknown tool: ${toolName}` });
    }

    const args = schema.parse(rawArgs);

    logger.info({ toolName, args: maskArgsForLogging(args), vapiCallId }, 'Tool call received');

    let result;
    try {
      result = await handleToolCall({ toolName, args, vapiCallId, accountRef: args.account_id });
    } catch (err) {
      if (err instanceof StateMachineViolation) {
        // Return this as a TOOL RESULT (not an HTTP error) so the model
        // gets a clear, structured reason it can react to conversationally
        // ("I'm not able to do that yet") rather than a silent failure.
        return res.status(200).json({
          results: [
            {
              toolCallId: callId,
              result: JSON.stringify({
                success: false,
                error: 'NOT_ALLOWED_IN_CURRENT_STATE',
                message: 'This action is not available yet in the current step of the call.',
              }),
            },
          ],
        });
      }
      throw err;
    }

    return res.status(200).json({
      results: [{ toolCallId: callId, result: JSON.stringify(result) }],
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
