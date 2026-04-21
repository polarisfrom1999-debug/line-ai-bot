'use strict';

const activeContextResolver = require('../active_context_resolver_service');
const labFollowupService = require('../../lab_followup_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function buildLatestLabPanel(shortMemory = {}) {
  return shortMemory?.activeContext?.payload?.labPanel
    || shortMemory?.followUpContext?.labPanel
    || null;
}

async function resolveFollowupV2({ input, text, shortMemory = {} }) {
  const safe = normalizeText(text || input?.rawText || '');
  if (!safe || input?.messageType !== 'text') return null;

  const activeReply = await activeContextResolver.resolveActiveContextFollowup({ input, text: safe, shortMemory });
  if (activeReply?.replyText) return activeReply;

  const panel = buildLatestLabPanel(shortMemory);
  if (panel && /わかるのは|何の項目|読み取れた項目|数値で読め|他に何が|他に読め/.test(safe)) {
    return {
      intentType: 'v2_lab_broad_followup',
      replyText: labFollowupService.buildReadableInventoryReply(panel)
    };
  }
  return null;
}

module.exports = {
  resolveFollowupV2,
};
