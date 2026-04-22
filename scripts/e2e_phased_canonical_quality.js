'use strict';

const assert = require('assert');

process.env.ENABLE_NEW_FLOW_ARCH = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_INGEST = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_FOLLOWUP = '1';
process.env.ENABLE_NEW_FLOW_GENERAL_FOLLOWUP = '0';
process.env.ENABLE_NEW_FLOW_RESPONSE_GUARD = '1';

const { orchestrateConversation } = require('../services/conversation_orchestrator_service');
const activeContextStoreService = require('../services/newflow/active_context_store_service');

function mkImageInput(userId, messageId, textHint) {
  return {
    userId,
    lineUserId: userId,
    messageType: 'image',
    messageId,
    rawText: textHint,
    webImagePayload: {
      buffer: Buffer.from(`phased-image-${messageId}`),
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

function pullText(result) {
  const msg = Array.isArray(result?.replyMessages) ? result.replyMessages.find((x) => x?.type === 'text') : null;
  return String(msg?.text || '');
}

async function expireActive(userId, domain, payload = {}) {
  await activeContextStoreService.setActiveContext(userId, {
    domain,
    payload,
    expiresAt: new Date(Date.now() - 30 * 1000).toISOString()
  });
}

async function run() {
  const userId = `phased-e2e-${Date.now()}`;
  await orchestrateConversation(mkImageInput(userId, `m-${Date.now()}-1`, '血液検査画像'));
  await expireActive(userId, 'lab_image_session', { expired: true });

  const qPatient = await orchestrateConversation(mkTextInput(userId, `m-${Date.now()}-2`, '患者名は？'));
  const patientText = pullText(qPatient);
  assert(patientText, 'patient canonical reply required');
  assert(/今確認できる範囲/.test(patientText), 'lab canonical should start with available scope');

  const qTrend = await orchestrateConversation(mkTextInput(userId, `m-${Date.now()}-3`, '変化は？'));
  const trendText = pullText(qTrend);
  assert(trendText, 'trend canonical reply required');
  assert(/確認|変化|項目/.test(trendText), 'lab trend should be natural and informative');

  await orchestrateConversation(mkImageInput(userId, `m-${Date.now()}-4`, '食事の写真'));
  const corr = await orchestrateConversation(mkTextInput(userId, `m-${Date.now()}-5`, '半分食べた'));
  const corrText = pullText(corr);
  assert(corrText, 'correction reply required');

  await expireActive(userId, 'meal_image_session', { expired: true });
  const qKcal = await orchestrateConversation(mkTextInput(userId, `m-${Date.now()}-6`, 'カロリーは？'));
  const kcalText = pullText(qKcal);
  assert(/今確認できる範囲/.test(kcalText), 'meal canonical should answer scope-first');
  assert(/kcal|カロリー/.test(kcalText), 'meal canonical should include kcal');

  console.log('e2e_phased_canonical_quality: ok');
  console.log(JSON.stringify({
    replies: {
      patientText: patientText.slice(0, 160),
      trendText: trendText.slice(0, 160),
      correctionText: corrText.slice(0, 160),
      kcalText: kcalText.slice(0, 160),
    }
  }, null, 2));
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
