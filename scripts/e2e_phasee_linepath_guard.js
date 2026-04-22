'use strict';

const assert = require('assert');

process.env.ENABLE_NEW_FLOW_ARCH = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_INGEST = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_FOLLOWUP = '1';
process.env.ENABLE_NEW_FLOW_GENERAL_FOLLOWUP = '0';
process.env.ENABLE_NEW_FLOW_RESPONSE_GUARD = '1';

const { orchestrateConversation } = require('../services/conversation_orchestrator_service');
const newflowImageIngest = require('../services/newflow/image_ingest_orchestrator_service');
const activeContextStoreService = require('../services/newflow/active_context_store_service');
const labSessionRepository = require('../repositories/lab_session_repository');

function mkImageInput(userId, messageId, textHint) {
  return {
    userId,
    lineUserId: userId,
    messageType: 'image',
    messageId,
    rawText: textHint,
    webImagePayload: {
      buffer: Buffer.from(`phasee-linepath-${messageId}`),
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

async function run() {
  const logs = [];
  const originalInfo = console.info;
  console.info = (...args) => {
    logs.push(args.map((x) => String(x)).join(' '));
    originalInfo(...args);
  };
  try {
    const userId = `phasee-fix-${Date.now()}`;
    await orchestrateConversation(mkImageInput(userId, `m-${Date.now()}-1`, '食事画像'));
    await orchestrateConversation(mkTextInput(userId, `m-${Date.now()}-2`, '半分食べました'));

    const oldImageHit = logs.some((line) => line.includes('[phasee-old] old_image_ingress_reached'));
    const oldFollowupHit = logs.some((line) => line.includes('[phasee-old] old_followup_reached'));
    assert(!oldImageHit, 'newflow path must not hit old_image_ingress');
    assert(!oldFollowupHit, 'newflow path must not hit old_followup');

    // 保存失敗時に active context を立てないことを確認
    const failUser = `${userId}-labfail`;
    const originalCreate = labSessionRepository.createLabSession;
    labSessionRepository.createLabSession = async () => ({ ok: false, reason: 'forced_failure_for_test' });
    const saveFailed = await newflowImageIngest.handleImageIngest({
      input: mkImageInput(failUser, `m-${Date.now()}-3`, '血液検査画像'),
      textHint: '血液検査画像'
    });
    labSessionRepository.createLabSession = originalCreate;
    assert(saveFailed?.intentType === 'newflow_lab_save_pending', 'lab save failure should return save_pending');
    const activeAfterFail = await activeContextStoreService.getActiveContext(failUser);
    assert(!activeAfterFail?.context?.type, 'active context must stay unset when lab save failed');

    // route_selected unknown のとき active を立てないことを確認
    const unknownUser = `${userId}-unknown`;
    const unknownRes = await newflowImageIngest.handleImageIngest({
      input: mkImageInput(unknownUser, `m-${Date.now()}-4`, ''),
      textHint: ''
    });
    assert(unknownRes?.intentType === 'newflow_image_unknown', 'unknown hint should stay unknown');
    const activeAfterUnknown = await activeContextStoreService.getActiveContext(unknownUser);
    assert(!activeAfterUnknown?.context?.type, 'unknown route must not set active context');

    console.log('e2e_phasee_linepath_guard: ok');
    console.log(JSON.stringify({
      evidence: {
        old_image_ingress_reached: oldImageHit,
        old_followup_reached: oldFollowupHit,
        save_failed_intent: saveFailed?.intentType || '',
        active_after_save_fail: activeAfterFail?.context?.type || null,
        unknown_intent: unknownRes?.intentType || '',
        active_after_unknown: activeAfterUnknown?.context?.type || null
      }
    }, null, 2));
  } finally {
    console.info = originalInfo;
  }
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
