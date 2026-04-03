'use strict';

/**
 * services/chatgpt_conversation_router.js
 *
 * 既存AI返答生成前に guidanceHints を自然に渡すための薄いラッパ。
 * 実環境で既存 router があれば、この構成だけ取り込みやすいよう最小にしている。
 */

function buildGuidanceHints(guidanceContext = {}) {
  const hints = [];
  for (const key of ['bridge', 'reentryGuide', 'supportMode', 'compass']) {
    const item = guidanceContext[key];
    if (item && item.guidanceHint) hints.push(`- ${item.guidanceHint}`);
  }
  return hints.join('\n');
}

async function routeConversation({
  userText,
  generateReply,
  guidanceContext = {},
  systemContext = '',
}) {
  const hints = buildGuidanceHints(guidanceContext);
  const composedSystem = [systemContext, hints ? `返答補助:\n${hints}` : ''].filter(Boolean).join('\n\n');
  return generateReply({ userText, systemContext: composedSystem, guidanceContext });
}

module.exports = {
  buildGuidanceHints,
  routeConversation,
};
