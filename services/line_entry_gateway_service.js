'use strict';

const inputGatewayService = require('./input_gateway_service');

async function tryHandleLineEntry(input = {}) {
  const result = await inputGatewayService.handleLineTopLevel(input);
  if (!result?.handled) return null;
  return {
    handled: true,
    replyText: Array.isArray(result.replyMessages) ? result.replyMessages.map((m) => m.text || '').filter(Boolean).join('\n') : '',
    replyMessages: result.replyMessages || [],
    internal: result.internal || {}
  };
}

module.exports = {
  tryHandleLineEntry
};
