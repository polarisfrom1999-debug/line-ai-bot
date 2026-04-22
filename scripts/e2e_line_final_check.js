'use strict';

process.env.ENABLE_NEW_FLOW_ARCH = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_INGEST = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_FOLLOWUP = '1';
process.env.ENABLE_NEW_FLOW_GENERAL_FOLLOWUP = '0';
process.env.ENABLE_NEW_FLOW_RESPONSE_GUARD = '1';

const { orchestrateConversation } = require('../services/conversation_orchestrator_service');
const activeContextStoreService = require('../services/newflow/active_context_store_service');

const INTERNAL_PATTERNS = [
  /intent\s*=/i,
  /\bbbox\b/i,
  /\bconfidence\b/i,
  /\braw\s*json\b/i,
  /保存確認が未完了/,
  /運用確認用/
];

function hasInternalText(text) {
  return INTERNAL_PATTERNS.some((p) => p.test(String(text || '')));
}

function mkImageInput(userId, messageId, textHint) {
  return {
    userId,
    lineUserId: userId,
    messageType: 'image',
    messageId,
    rawText: textHint,
    webImagePayload: {
      buffer: Buffer.from(`line-final-${messageId}`),
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

async function run() {
  const userId = `line-final-${Date.now()}`;
  const logLines = [];
  const originalInfo = console.info;
  console.info = (...args) => {
    const line = args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    logLines.push(line);
    originalInfo(...args);
  };

  try {
    const results = [];

    // 1) 血液検査画像 → TG
    const s1img = await orchestrateConversation(mkImageInput(userId, `m-${Date.now()}-1`, '血液検査画像'));
    const s1q = await orchestrateConversation(mkTextInput(userId, `m-${Date.now()}-2`, 'TGは？'));
    const ctx1 = await activeContextStoreService.getActiveContext(userId);
    results.push({
      scenario: '1. lab image -> TG',
      reply_image: pullText(s1img),
      reply_followup: pullText(s1q),
      internal_leak: hasInternalText(pullText(s1img)) || hasInternalText(pullText(s1q)),
      active_context: ctx1?.context?.type || null,
    });

    // 2) 直後に食事画像 → 半分食べました
    const s2img = await orchestrateConversation(mkImageInput(userId, `m-${Date.now()}-3`, '食事画像'));
    const s2q = await orchestrateConversation(mkTextInput(userId, `m-${Date.now()}-4`, '半分食べました'));
    const ctx2 = await activeContextStoreService.getActiveContext(userId);
    results.push({
      scenario: '2. meal image -> 半分食べました',
      reply_image: pullText(s2img),
      reply_followup: pullText(s2q),
      internal_leak: hasInternalText(pullText(s2img)) || hasInternalText(pullText(s2q)),
      active_context: ctx2?.context?.type || null,
    });

    // 3) 読みにくい画像（unknown）
    const s3img = await orchestrateConversation(mkImageInput(userId, `m-${Date.now()}-5`, ''));
    const ctx3 = await activeContextStoreService.getActiveContext(userId);
    results.push({
      scenario: '3. unreadable image -> unknown',
      reply_image: pullText(s3img),
      reply_followup: '',
      internal_leak: hasInternalText(pullText(s3img)),
      active_context: ctx3?.context?.type || null,
    });

    const oldRouteHit = logLines.filter((x) => x.includes('[phasee-old] old_image_ingress_reached') || x.includes('[phasee-old] old_followup_reached'));
    const activeSwitchLogs = logLines.filter((x) => x.includes('[v2-context] active_context_switched') || x.includes('[v2-context] previous_context_closed'));
    const routeLogs = logLines.filter((x) => x.includes('[v2-image] route_selected'));

    console.log('e2e_line_final_check: ok');
    console.log(JSON.stringify({
      old_route_hits: oldRouteHit,
      route_logs: routeLogs,
      context_logs: activeSwitchLogs,
      scenarios: results,
    }, null, 2));
  } finally {
    console.info = originalInfo;
  }
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
