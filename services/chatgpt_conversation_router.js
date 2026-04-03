'use strict';

function buildGuidanceHints(guidanceContext = {}) {
  const hints = [];
  for (const key of ['bridge', 'reentryGuide', 'supportMode', 'compass', 'sports', 'movement']) {
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
