'use strict';

const activeContextResolver = require('../active_context_resolver_service');
const activeContextService = require('../../active_context_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function isIntentCompatibleWithContext(contextType, intentType) {
  const ctx = normalizeText(contextType);
  const intent = normalizeText(intentType);
  if (!ctx || !intent) return true;
  if (/^lab_/.test(ctx) && /meal/.test(intent)) return false;
  if (/^meal_/.test(ctx) && /lab/.test(intent)) return false;
  return true;
}

async function resolveFollowupV2({ input, text, shortMemory = {} }) {
  const safe = normalizeText(text || input?.rawText || '').replace(/？/g, '?');
  if (!safe || input?.messageType !== 'text') return null;
  console.info('[phasee-old] old_followup_reached', { userId: input?.userId || '', text: safe.slice(0, 60) });

  const status = await activeContextService.getActiveContextStatus(input.userId, shortMemory).catch(() => ({ context: null, expired: false }));
  if (status?.expired) {
    return {
      intentType: 'v2_context_expired',
      replyText: '前の画像は保持期限が切れています。もう一度送ってください'
    };
  }
  const active = status?.context;
  if (!active?.type) return null;
  console.info('[v2-followup] active_context', { userId: input.userId, context_type: active.type, query_type: 'text' });

  const activeReply = await activeContextResolver.resolveActiveContextFollowup({ input, text: safe, shortMemory });
  if (activeReply?.replyText) {
    if (!isIntentCompatibleWithContext(active.type, activeReply.intentType || '')) {
      console.info('[phasee-old] old_reject_first_path', { userId: input?.userId || '', reason: 'context_response_mismatch' });
      console.error('[v2-error] reason=context_response_mismatch fallback=domain_guard_block', {
        userId: input.userId,
        context_type: active.type,
        intent: activeReply.intentType || ''
      });
      return null;
    }
    console.info('[v2-followup] followup_intent_resolved', {
      userId: input.userId,
      intent: activeReply.intentType || 'active_followup',
      context_type: active.type,
      query_type: 'text'
    });
    await activeContextService.touchActiveContextTtl(input.userId, active).catch(() => null);
    return activeReply;
  }
  return null;
}

module.exports = {
  resolveFollowupV2,
};
