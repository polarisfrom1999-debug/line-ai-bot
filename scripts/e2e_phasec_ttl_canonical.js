'use strict';

const assert = require('assert');

process.env.ENABLE_NEW_FLOW_ARCH = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_INGEST = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_FOLLOWUP = '1';
process.env.ENABLE_NEW_FLOW_GENERAL_FOLLOWUP = '0';
process.env.ENABLE_NEW_FLOW_RESPONSE_GUARD = '1';

const { orchestrateConversation } = require('../services/conversation_orchestrator_service');
const activeContextStoreService = require('../services/newflow/active_context_store_service');

const INTERNAL_PATTERNS = [/intent\s*=/i, /\bbbox\b/i, /\bconfidence\b/i, /\braw\s*json\b/i, /保存確認が未完了/, /運用確認用/];

function hasInternalText(text) {
  return INTERNAL_PATTERNS.some((p) => p.test(String(text || '')));
}

function pullText(result) {
  const msg = Array.isArray(result?.replyMessages) ? result.replyMessages.find((x) => x?.type === 'text') : null;
  return String(msg?.text || '');
}

function mkImageInput(userId, messageId, textHint) {
  return {
    userId,
    lineUserId: userId,
    messageType: 'image',
    messageId,
    rawText: textHint,
    webImagePayload: {
      buffer: Buffer.from(`phasec-image-${messageId}`),
      mimeType: 'image/jpeg',
    },
  };
}

function mkTextInput(userId, messageId, text) {
  return {
    userId,
    lineUserId: userId,
    messageType: 'text',
    messageId,
    rawText: text,
  };
}

async function expireActive(userId, domain, payload = {}) {
  await activeContextStoreService.setActiveContext(userId, {
    domain,
    payload,
    expiresAt: new Date(Date.now() - 60 * 1000).toISOString()
  });
}

async function run() {
  const userId = `phasec-e2e-${Date.now()}`;

  const labImg = await orchestrateConversation(mkImageInput(userId, `m-${Date.now()}-1`, '血液検査の写真'));
  assert(labImg?.ok, 'lab image should be handled');
  assert(!hasInternalText(pullText(labImg)), 'lab image reply must not leak internal text');

  await expireActive(userId, 'lab_image_session', { forced: 'expired' });
  const labFollowupCanonical = await orchestrateConversation(mkTextInput(userId, `m-${Date.now()}-2`, 'TGは？'));
  const labCanonText = pullText(labFollowupCanonical);
  assert(labCanonText, 'canonical lab fallback should answer');
  assert(!hasInternalText(labCanonText), 'canonical lab reply must not leak internal text');

  const ttlResend = await orchestrateConversation(mkTextInput(userId, `m-${Date.now()}-3`, 'これどうだった？'));
  const ttlText = pullText(ttlResend);
  assert(/保持期限が切れ|もう一度.*画像/.test(ttlText), 'expired unknown followup should prompt resend naturally');
  assert(!hasInternalText(ttlText), 'ttl resend reply must not leak internal text');

  const mealImg = await orchestrateConversation(mkImageInput(userId, `m-${Date.now()}-4`, '食事の写真'));
  assert(mealImg?.ok, 'meal image should be handled');
  assert(!hasInternalText(pullText(mealImg)), 'meal image reply must not leak internal text');

  await expireActive(userId, 'meal_image_session', { forced: 'expired' });
  const mealCanonical = await orchestrateConversation(mkTextInput(userId, `m-${Date.now()}-5`, 'カロリーは？'));
  const mealCanonText = pullText(mealCanonical);
  assert(/kcal|カロリー/.test(mealCanonText), 'canonical meal fallback should answer kcal');
  assert(!hasInternalText(mealCanonText), 'canonical meal reply must not leak internal text');

  console.log('e2e_phasec_ttl_canonical: ok');
  console.log(JSON.stringify({
    replies: {
      labCanonical: labCanonText.slice(0, 120),
      ttlResend: ttlText.slice(0, 120),
      mealCanonical: mealCanonText.slice(0, 120),
    }
  }, null, 2));
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
