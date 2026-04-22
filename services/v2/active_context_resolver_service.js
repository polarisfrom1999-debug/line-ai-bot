'use strict';

const activeContextService = require('../active_context_service');
const labFollowupService = require('../lab_followup_service');
const mealCorrectionService = require('../newflow/meal_correction_service');

function normalizeText(value) {
  return String(value || '').trim();
}

const EXPIRED_CONTEXT_REPLY = '前の画像は保持期限が切れています。もう一度送ってください';

function isBroadLabFollowup(safe) {
  const s = normalizeText(safe).replace(/？/g, '?');
  return /わかるのは|何の項目|読み取れた項目|数値で読め|他に何が|他に読め|検査項目は|他の項目で確認出来たのは|他の検査結果で読めたのは|検査結果でわかるのある|この結果どう見える|異常ありそう/.test(s);
}

async function resolveActiveContextFollowup({ input, text }) {
  const safe = normalizeText(text || input?.rawText || '').replace(/？/g, '?');
  if (!safe) return null;

  const status = await activeContextService.getActiveContextStatus(input.userId).catch(() => ({ context: null, expired: false }));
  if (status?.expired) {
    return { intentType: 'v2_context_expired', replyText: EXPIRED_CONTEXT_REPLY };
  }
  const active = status?.context;
  if (!active?.type) return null;

  const type = normalizeText(active.type);
  console.info('[v2-followup] active_context', { userId: input.userId, context_type: type, query_type: 'text' });
  if (/^lab_/.test(type)) {
    const panel = active?.payload?.labPanel || null;
    if (!panel) return null;
    if (/患者名|氏名/.test(safe)) return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildPatientNameReply(panel) };
    if (/病院名|医院名|クリニック名|医療機関/.test(safe)) return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildFacilityNameReply(panel) };
    if (/印刷日|発行日|出力日/.test(safe)) return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildPrintDateReply(panel) };
    if (/日付|検査日|採血日|一番新しい日付|最新日/.test(safe)) return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildExamDateQuickReply(panel) };
    if (/異常がついている項目|異常項目|H\/L|ハイフラグ|ローフラグ/.test(safe)) return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildAbnormalItemsReply(panel) };
    if (isBroadLabFollowup(safe)) return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildReadableInventoryReply(panel) };
    const target = labFollowupService.normalizeTarget(safe);
    if (target) {
      const selectedDate = panel?.latestExamDate || panel?.examDate || '';
      return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildItemReply(panel, target, selectedDate) };
    }
    return null;
  }

  if (/^meal_/.test(type)) {
    return mealCorrectionService.resolveMealFollowupFromSession({
      input,
      text: safe,
      activeContext: active
    });
  }

  return null;
}

module.exports = {
  resolveActiveContextFollowup,
};
