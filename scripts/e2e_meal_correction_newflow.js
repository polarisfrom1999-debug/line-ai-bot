'use strict';

process.env.ENABLE_NEW_FLOW_ARCH = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_FOLLOWUP = '1';
process.env.ENABLE_NEW_FLOW_GENERAL_FOLLOWUP = '0';

const { resolveFollowup } = require('../services/newflow/followup_router_service');
const { orchestrateConversation } = require('../services/conversation_orchestrator_service');
const activeContextStoreService = require('../services/newflow/active_context_store_service');

async function run() {
  const lines = [];
  const oldInfo = console.info;
  console.info = (...args) => {
    const line = args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    lines.push(line);
    oldInfo(...args);
  };
  const userId = `meal-corr-${Date.now()}`;

  try {
    await activeContextStoreService.setActiveContext(userId, {
      domain: 'meal_image_session',
      payload: {
        sourceMessageId: 'm-test-1',
        sourceImageId: 'img-test-1',
        meal: { items: ['丼物'], isMealImage: true, estimatedNutrition: { kcal: 500, p: 20, f: 10, c: 50 } }
      }
    });

    const step1 = await resolveFollowup({
      input: { userId, messageType: 'text', rawText: '半分食べました' },
      text: '半分食べました',
      imageFollowupOnly: true
    });

    const textOut = await orchestrateConversation({
      userId,
      lineUserId: userId,
      messageType: 'text',
      messageId: 'm-2',
      rawText: '半分食べました'
    });

    const newCorrection = lines.filter((x) => x.includes('newflow_meal_correction_reached'));
    const newFollowup = lines.filter((x) => x.includes('new_followup_router_reached'));
    const oldAny = lines.filter((x) => x.includes('[phasee-old]') || x.includes('phasee-old'));
    const mealCorrIntent = lines.filter((x) => x.includes('newflow-followup] meal_correction_intent'));
    const replyText = String(textOut?.replyMessages?.find((m) => m?.type === 'text')?.text || '');

    console.log('e2e_meal_correction_newflow: ok');
    console.log(JSON.stringify({
      resolveFollowup: step1,
      reply_preview: replyText.slice(0, 200),
      newflow_meal_correction_reached: newCorrection,
      new_followup_router_reached: newFollowup,
      meal_correction_intent_lines: mealCorrIntent,
      phasee_old_hits: oldAny
    }, null, 2));
  } finally {
    console.info = oldInfo;
  }
}

run().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
