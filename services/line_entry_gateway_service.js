'use strict';

const webLinkCommandService = require('./web_link_command_service');

function normalizeText(value) {
  return String(value || '').trim();
}

async function tryHandleLineEntry(input = {}) {
  const messageType = normalizeText(input?.messageType || '');
  const rawText = normalizeText(input?.rawText || '');
  if (messageType !== 'text' || !rawText) return null;

  if (webLinkCommandService.isWebLinkCommand(rawText)) {
    const issued = await webLinkCommandService.buildWebLinkReplyByLineUser(input.lineUserId || input.userId);
    return {
      handled: true,
      replyText: issued.replyText,
      replyMessages: [{ type: 'text', text: issued.replyText }],
      internal: issued.internal
    };
  }

  return null;
}

module.exports = {
  tryHandleLineEntry
};
