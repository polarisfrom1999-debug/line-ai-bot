'use strict';

/**
 * services/chat_context_service.js
 */

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function pickLastUserText(messages = []) {
  if (!Array.isArray(messages)) return '';
  const last = [...messages].reverse().find((m) => m && m.role === 'user' && m.text);
  return safeText(last?.text || '');
}

function buildConversationContext(input = {}) {
  const user = input.user || {};
  const recentMessages = Array.isArray(input.recentMessages) ? input.recentMessages : [];

  return {
    display_name: safeText(user.display_name || ''),
    ai_persona_type: safeText(user.ai_persona_type || user.ai_type || ''),
    current_flow: safeText(user.current_flow || ''),
    last_user_text: pickLastUserText(recentMessages),
    pending_capture_type: safeText(user.pending_capture_type || ''),
    has_pending_capture:
      !!user.pending_capture_type &&
      user.pending_capture_status === 'awaiting_clarification' &&
      !!user.pending_capture_payload,
  };
}

module.exports = {
  safeText,
  buildConversationContext,
};
