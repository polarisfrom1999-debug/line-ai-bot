'use strict';

const conversationOrchestratorService = require('./conversation_orchestrator_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeConversationInput(input) {
  const event = input?.originalEvent || null;
  const messageType = input?.messageType || event?.message?.type || 'text';
  const rawText =
    typeof input?.rawText === 'string'
      ? input.rawText
      : messageType === 'text'
        ? String(event?.message?.text || '')
        : '';

  return {
    userId: input?.userId || event?.source?.userId || null,
    replyToken: input?.replyToken || event?.replyToken || null,
    messageType,
    rawText: normalizeText(rawText),
    imageMeta: input?.imageMeta || null,
    messageId: input?.messageId || event?.message?.id || null,
    timestamp: input?.timestamp || event?.timestamp || Date.now(),
    sourceType: input?.sourceType || event?.source?.type || 'unknown',
    originalEvent: event
  };
}

async function routeConversation(input) {
  const normalized = normalizeConversationInput(input);

  return conversationOrchestratorService.orchestrateConversation({
    ...normalized,
    routerHints: {}
  });
}

module.exports = {
  routeConversation
};
