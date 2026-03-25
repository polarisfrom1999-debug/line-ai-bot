'use strict';

const { routeConversation } = require('./chatgpt_conversation_router');
const { parseWeightLog } = require('./weight_service');
const { looksLikeConsultation, analyzeNewCaptureCandidate } = require('./capture_router_service');

async function analyzeChatCapture(input = {}) {
  const text = String(input.text || '').trim();
  const context = input.context || {};
  if (!text) return null;

  const metrics = parseWeightLog(text);
  if (metrics?.weight_kg != null || metrics?.body_fat_pct != null) {
    return { route: 'body_metrics', payload: metrics };
  }

  const routed = analyzeNewCaptureCandidate(text);
  if (routed.route === 'consultation' || looksLikeConsultation(text)) {
    const conversation = await routeConversation({ currentUserText: text, text, context });
    return { route: 'consultation', replyText: conversation.replyText || conversation.text || '' };
  }

  return { route: routed.route || 'conversation', replyText: '' };
}

module.exports = { analyzeChatCapture };
