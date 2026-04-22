'use strict';

process.env.ENABLE_NEW_FLOW_ARCH = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_INGEST = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_FOLLOWUP = '1';
process.env.ENABLE_NEW_FLOW_GENERAL_FOLLOWUP = '0';

const { orchestrateConversation } = require('../services/conversation_orchestrator_service');
const activeContextStoreService = require('../services/newflow/active_context_store_service');
const geminiDispatchService = require('../services/gemini_dispatch_service');

function mkImageInput(userId, messageId) {
  return {
    userId,
    lineUserId: userId,
    messageType: 'image',
    messageId,
    rawText: '',
    webImagePayload: {
      buffer: Buffer.from(`proof-${messageId}`),
      mimeType: 'image/jpeg'
    }
  };
}

function mealDecision() {
  return {
    ok: true,
    json: {
      schema_version: 'image-domain-v1',
      domain: 'meal',
      confidence: 0.87,
      meal_evidence: {
        is_food_photo: true,
        dish_count: 2,
        has_tableware_or_plate: true,
        nutrition_estimation_possible: true
      },
      lab_evidence: {
        is_lab_report: false,
        has_test_item_rows: false,
        has_reference_range_or_units: false,
        has_exam_date_or_patient_fields: false
      },
      reason_codes: ['food_visible'],
      notes: 'meal'
    }
  };
}

function labDecision() {
  return {
    ok: true,
    json: {
      schema_version: 'image-domain-v1',
      domain: 'lab',
      confidence: 0.9,
      meal_evidence: {
        is_food_photo: false,
        dish_count: 0,
        has_tableware_or_plate: false,
        nutrition_estimation_possible: false
      },
      lab_evidence: {
        is_lab_report: true,
        has_test_item_rows: true,
        has_reference_range_or_units: true,
        has_exam_date_or_patient_fields: true
      },
      reason_codes: ['lab_sheet_layout'],
      notes: 'lab'
    }
  };
}

function unknownDecision() {
  return {
    ok: true,
    json: {
      schema_version: 'image-domain-v1',
      domain: 'unknown',
      confidence: 0.22,
      meal_evidence: {
        is_food_photo: false,
        dish_count: 0,
        has_tableware_or_plate: false,
        nutrition_estimation_possible: false
      },
      lab_evidence: {
        is_lab_report: false,
        has_test_item_rows: false,
        has_reference_range_or_units: false,
        has_exam_date_or_patient_fields: false
      },
      reason_codes: ['insufficient_visual_signal'],
      notes: 'unknown'
    }
  };
}

function chooseDecisionFromPayload(imagePayload) {
  const marker = Buffer.isBuffer(imagePayload?.buffer) ? imagePayload.buffer.toString('utf8') : '';
  if (marker.includes('lab')) return labDecision();
  if (marker.includes('unknown')) return unknownDecision();
  return mealDecision();
}

async function run() {
  const original = geminiDispatchService.generateStructuredImageJson;
  const lines = [];
  const originalInfo = console.info;
  console.info = (...args) => {
    const line = args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    lines.push(line);
    originalInfo(...args);
  };
  geminiDispatchService.generateStructuredImageJson = async ({ imagePayload }) => chooseDecisionFromPayload(imagePayload);

  try {
    const userMeal = `proof-meal-${Date.now()}`;
    await orchestrateConversation(mkImageInput(userMeal, 'msg-meal'));
    const ctxMeal = await activeContextStoreService.getActiveContext(userMeal);

    const userLab = `proof-lab-${Date.now()}`;
    await orchestrateConversation(mkImageInput(userLab, 'msg-lab'));
    const ctxLab = await activeContextStoreService.getActiveContext(userLab);

    const userUnknown = `proof-unknown-${Date.now()}`;
    await orchestrateConversation(mkImageInput(userUnknown, 'msg-unknown'));
    const ctxUnknown = await activeContextStoreService.getActiveContext(userUnknown);

    const routeLogs = lines.filter((x) => x.includes('[v2-image] route_selected'));
    const contextLogs = lines.filter((x) => x.includes('[v2-context] active_context_switched'));

    console.log('e2e_image_route_router_proof: ok');
    console.log(JSON.stringify({
      route_logs: routeLogs,
      context_logs: contextLogs,
      active_contexts: {
        meal: ctxMeal?.context?.type || null,
        lab: ctxLab?.context?.type || null,
        unknown: ctxUnknown?.context?.type || null
      }
    }, null, 2));
  } finally {
    geminiDispatchService.generateStructuredImageJson = original;
    console.info = originalInfo;
  }
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
