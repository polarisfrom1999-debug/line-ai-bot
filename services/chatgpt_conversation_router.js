'use strict';

const { generateSupportReply } = require('./ai_chat_service');
const { buildRememberedHints } = require('./context_memory_service');

async function routeConversation({ currentUserText = '', text = '', recentMessages = [], context = {} } = {}) {
  const raw = String(currentUserText || text || '').trim();
  const user = context?.user || {};
  const memoryHints = buildRememberedHints(user, context?.extra || {});

  const reply = await generateSupportReply({
    user,
    text: raw,
    recentTurns: recentMessages || [],
    memoryHints,
    mode: context?.mode || 'support',
  });

  return {
    route: 'conversation',
    is_ambiguous: false,
    needs_clarification: false,
    replyText: reply,
    reply_text: reply,
    meta: {
      topic_hints: { conversation: true },
    },
  };
}

module.exports = {
  routeConversation,
};
