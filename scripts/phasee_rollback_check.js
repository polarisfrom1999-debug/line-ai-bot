'use strict';

const assert = require('assert');

function mkImageInput(userId, messageId, textHint) {
  return {
    userId,
    lineUserId: userId,
    messageType: 'image',
    messageId,
    rawText: textHint,
    webImagePayload: {
      buffer: Buffer.from(`phasee-image-${messageId}`),
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

async function runWithFlags(flags, scenarioName) {
  process.env.ENABLE_NEW_FLOW_IMAGE_INGEST = flags.imageIngest ? '1' : '0';
  process.env.ENABLE_NEW_FLOW_IMAGE_FOLLOWUP = flags.imageFollowup ? '1' : '0';
  process.env.ENABLE_NEW_FLOW_GENERAL_FOLLOWUP = flags.generalFollowup ? '1' : '0';
  process.env.ENABLE_NEW_FLOW_RESPONSE_GUARD = flags.responseGuard ? '1' : '0';
  const { orchestrateConversation } = require('../services/conversation_orchestrator_service');
  const uid = `${scenarioName}-${Date.now()}`;
  const img = await orchestrateConversation(mkImageInput(uid, `m-${Date.now()}-1`, '食事画像'));
  const follow = await orchestrateConversation(mkTextInput(uid, `m-${Date.now()}-2`, '半分食べた'));
  return {
    imageIntent: String(img?.internal?.intentType || ''),
    followIntent: String(follow?.internal?.intentType || ''),
  };
}

async function run() {
  const newFlow = await runWithFlags({
    imageIngest: true,
    imageFollowup: true,
    generalFollowup: false,
    responseGuard: true,
  }, 'phasee-new');
  assert(/newflow_|meal_image|lab_image/.test(newFlow.imageIntent), 'new flow image path should run');

  const rollback = await runWithFlags({
    imageIngest: false,
    imageFollowup: false,
    generalFollowup: false,
    responseGuard: true,
  }, 'phasee-old');
  assert(!/^newflow_/.test(rollback.imageIntent), 'rollback should avoid newflow image intent');

  console.log('phasee_rollback_check: ok');
  console.log(JSON.stringify({ newFlow, rollback }, null, 2));
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
