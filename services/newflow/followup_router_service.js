'use strict';

const activeContextStoreService = require('./active_context_store_service');
const labFollowupService = require('../lab_followup_service');
const mealFollowupResolverService = require('../v2/followups/meal_followup_resolver_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function looksLikeGeneralConversation(text) {
  const safe = normalizeText(text);
  if (!safe) return true;
  return !/(TG|LDL|HDL|HbA1c|検査|患者名|クリニック|麺|カロリー|半分|食べてない|0kcal|食事)/i.test(safe);
}

/**
 * Phase A skeleton:
 * - active context は必ず active_context_store_service 経由で1件取得
 * - shortMemory / 旧context helper には依存しない
 * - 実際の回答生成は次フェーズで実装
 */
async function resolveFollowup({ input, text, imageFollowupOnly = true } = {}) {
  const safeText = normalizeText(text || input?.rawText || '');
  if (!safeText || input?.messageType !== 'text') return null;

  const status = await activeContextStoreService.getActiveContext(input?.userId);
  if (status?.expired) {
    return {
      intentType: 'newflow_context_expired',
      replyText: '前の画像は保持期限が切れています。もう一度送ってください。'
    };
  }

  const active = status?.context;
  if (!active?.domain) return null;
  const isGeneral = looksLikeGeneralConversation(safeText);
  if (imageFollowupOnly && isGeneral) return null;
  if (!/_image_session$/.test(normalizeText(active.type || active.domain || ''))) return null;

  if (/^lab_/.test(normalizeText(active.type || active.domain || ''))) {
    const panel = active?.payload?.labPanel || null;
    if (!panel) return null;
    if (/患者名|氏名/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildPatientNameReply(panel) };
    if (/病院名|医院名|クリニック名|医療機関/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildFacilityNameReply(panel) };
    if (/印刷日|発行日|出力日/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildPrintDateReply(panel) };
    if (/日付|検査日|採血日|一番新しい日付|最新日/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildExamDateQuickReply(panel) };
    if (/異常がついている項目|異常項目|H\/L|ハイフラグ|ローフラグ/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildAbnormalItemsReply(panel) };
    if (/わかるのは|何の項目|読み取れた項目|数値で読め|他に何が|他に読め|検査項目は|他の項目で確認出来たのは|他の検査結果で読めたのは|検査結果でわかるのある|この結果どう見える|異常ありそう/.test(safeText)) {
      return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildReadableInventoryReply(panel) };
    }
    const target = labFollowupService.normalizeTarget(safeText);
    if (target) {
      const selectedDate = panel?.latestExamDate || panel?.examDate || '';
      return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildItemReply(panel, target, selectedDate) };
    }
    return {
      intentType: 'newflow_lab_followup',
      replyText: 'この画像で確認できる範囲でお答えします。項目名（例: TG, LDL, HbA1c）を指定してもう一度聞いてください。'
    };
  }
  if (/^meal_/.test(normalizeText(active.type || active.domain || ''))) {
    const mealReply = await mealFollowupResolverService.resolveMealFollowupFromSession({
      input,
      text: safeText,
      activeContext: active
    });
    if (mealReply?.replyText) return mealReply;
    return {
      intentType: 'newflow_meal_followup',
      replyText: 'この食事画像の補正として処理します。「麺だけ0kcal」「半分食べた」「食べてない」のように指定してください。'
    };
  }
  return null;
}

module.exports = {
  resolveFollowup,
};
