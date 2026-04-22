'use strict';

const assert = require('assert');
process.env.ENABLE_NEW_FLOW_ARCH = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_INGEST = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_FOLLOWUP = '1';
process.env.ENABLE_NEW_FLOW_GENERAL_FOLLOWUP = '0';
process.env.ENABLE_NEW_FLOW_RESPONSE_GUARD = '1';

const { orchestrateConversation } = require('../services/conversation_orchestrator_service');
process.env.ENABLE_NEW_FLOW_ARCH = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_INGEST = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_FOLLOWUP = '1';
process.env.ENABLE_NEW_FLOW_GENERAL_FOLLOWUP = '0';
process.env.ENABLE_NEW_FLOW_RESPONSE_GUARD = '1';

const BLOCK_PATTERNS = [
  /intent\s*=/i,
  /\bbbox\b/i,
  /\bconfidence\b/i,
  /\braw\s*json\b/i,
  /保存確認が未完了/,
  /運用確認用/,
];

function hasBlockedText(text) {
  return BLOCK_PATTERNS.some((p) => p.test(String(text || '')));
}

function mkImageInput({ userId, messageId, textHint }) {
  return {
    userId,
    lineUserId: userId,
    messageType: 'image',
    messageId,
    rawText: textHint,
    webImagePayload: {
      buffer: Buffer.from('phaseb-image-payload'),
      mimeType: 'image/jpeg',
    },
  };
}

function mkTextInput({ userId, text, messageId }) {
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

async function run() {
  const userId = `phaseb-e2e-${Date.now()}`;

  const labImage = await orchestrateConversation(mkImageInput({
    userId,
    messageId: `m-${Date.now()}-1`,
    textHint: '血液検査の結果です'
  }));
  assert(labImage?.ok, 'lab image should be handled');
  const labText = pullText(labImage);
  assert(labText, 'lab image reply is required');
  assert(!hasBlockedText(labText), 'lab image reply must not contain internal text');

  const tgFollowup = await orchestrateConversation(mkTextInput({
    userId,
    messageId: `m-${Date.now()}-2`,
    text: 'TGは？'
  }));
  assert(tgFollowup?.ok, 'lab followup should be handled');
  const tgText = pullText(tgFollowup);
  assert(tgText, 'lab followup reply is required');
  assert(!hasBlockedText(tgText), 'lab followup reply must not contain internal text');

  const mealImage = await orchestrateConversation(mkImageInput({
    userId,
    messageId: `m-${Date.now()}-3`,
    textHint: '食事の写真です'
  }));
  assert(mealImage?.ok, 'meal image should be handled');
  const mealText = pullText(mealImage);
  assert(mealText, 'meal image reply is required');
  assert(!hasBlockedText(mealText), 'meal image reply must not contain internal text');

  const halfFollowup = await orchestrateConversation(mkTextInput({
    userId,
    messageId: `m-${Date.now()}-4`,
    text: '半分しか食べてない'
  }));
  assert(halfFollowup?.ok, 'meal followup should be handled');
  const halfText = pullText(halfFollowup);
  assert(halfText, 'meal followup reply is required');
  assert(!hasBlockedText(halfText), 'meal followup reply must not contain internal text');

  console.log('e2e_phaseb_newflow: ok');
  console.log(JSON.stringify({
    replies: {
      labImage: labText.slice(0, 120),
      tgFollowup: tgText.slice(0, 120),
      mealImage: mealText.slice(0, 120),
      halfFollowup: halfText.slice(0, 120),
    }
  }, null, 2));
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
