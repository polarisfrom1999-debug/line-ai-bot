'use strict';

const activeContextService = require('../active_context_service');
const labFollowupService = require('../lab_followup_service');
const contextMemoryService = require('../context_memory_service');
const mealLogQueryService = require('../meal_log_query_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function mealLogsToRecordMeals(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    name: normalizeText(row?.mealLabel || row?.meal_label || '食事'),
    kcal: Number(row?.kcal || 0),
    protein: Number(row?.protein || 0),
    fat: Number(row?.fat || 0),
    carbs: Number(row?.carbs || 0),
  }));
}

function buildTodayMealTotalsAnswerFromRows(rows = []) {
  const agg = mealLogQueryService.aggregateMealLogs(rows);
  return `【今日の食事集計】\n件数: ${Number(agg?.count || 0)}件\n合計: 約${Number(agg?.kcal || 0).toFixed(1)} kcal`;
}

function buildLabPanelFromMemory(shortMemory = {}, active = null) {
  return active?.payload?.labPanel
    || shortMemory?.followUpContext?.labPanel
    || null;
}

function isBroadLabFollowup(safe) {
  const s = normalizeText(safe).replace(/？/g, '?');
  return /わかるのは|何の項目|読み取れた項目|数値で読め|他に何が|他に読め|検査項目は|他の項目で確認出来たのは|他の検査結果で読めたのは|検査結果でわかるのある|この結果どう見える|異常ありそう/.test(s);
}

async function resolveActiveContextFollowup({ input, text, shortMemory = {} }) {
  const safe = normalizeText(text || input?.rawText || '').replace(/？/g, '?');
  if (!safe) return null;

  const active = await activeContextService.getActiveContext(input.userId, shortMemory);
  if (!active?.type) return null;

  const type = normalizeText(active.type);
  if (/^lab_/.test(type)) {
    const panel = buildLabPanelFromMemory(shortMemory, active);
    if (!panel) return null;
    if (/患者名|氏名/.test(safe)) return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildPatientNameReply(panel) };
    if (/病院名|医院名|クリニック名|医療機関/.test(safe)) return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildFacilityNameReply(panel) };
    if (/印刷日|発行日|出力日/.test(safe)) return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildPrintDateReply(panel) };
    if (/日付|検査日|採血日|一番新しい日付|最新日/.test(safe)) return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildExamDateQuickReply(panel) };
    if (/異常がついている項目|異常項目|H\/L|ハイフラグ|ローフラグ/.test(safe)) return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildAbnormalItemsReply(panel) };
    if (isBroadLabFollowup(safe)) return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildReadableInventoryReply(panel) };
    const target = labFollowupService.normalizeTarget(safe);
    if (target) {
      const selectedDate = shortMemory?.followUpContext?.selectedLabExamDate || panel?.latestExamDate || panel?.examDate || '';
      return { intentType: 'v2_active_lab_followup', replyText: labFollowupService.buildItemReply(panel, target, selectedDate) };
    }
    return null;
  }

  if (/^meal_/.test(type)) {
    if (/ゼロ|0kcal|0 kcal|食べてない|食べなかった|キャンセル|取り消し|削除して|消して|同じ写真送ってしまった|一個だけ|一部だけ食べた/.test(safe)) {
      const del = await contextMemoryService.deleteLastMealLog(input.userId);
      if (!del?.ok) {
        return {
          intentType: 'v2_active_meal_followup',
          replyText: '対象の食事を特定できませんでした。「この食事を削除して」または時刻付きで送ってください。'
        };
      }
      const today = contextMemoryService.getTokyoTodayYmd();
      const rows = await mealLogQueryService.getMealLogsByDateRange(input.userId, today, today);
      await activeContextService.clearActiveContext(input.userId, shortMemory);
      return {
        intentType: 'v2_active_meal_followup',
        replyText: ['了解です。直近の食事記録を取り消しました。', '', buildTodayMealTotalsAnswerFromRows(rows)].join('\n')
      };
    }
    if (/その夕食のカロリー|最後の食事のカロリー|その麺カロリー|カロリーは\??/.test(safe)) {
      const today = contextMemoryService.getTokyoTodayYmd();
      const rows = await mealLogQueryService.getMealLogsByDateRange(input.userId, today, today);
      const latest = (Array.isArray(rows) ? rows : [])[0] || null;
      if (latest) {
        return {
          intentType: 'v2_active_meal_followup',
          replyText: `直近の食事「${normalizeText(latest.mealLabel || '食事')}」は約${Number(latest.kcal || 0).toFixed(1)} kcal です。`
        };
      }
      return { intentType: 'v2_active_meal_followup', replyText: '直近の食事記録が見つかりませんでした。' };
    }
  }

  return null;
}

module.exports = {
  resolveActiveContextFollowup,
};
