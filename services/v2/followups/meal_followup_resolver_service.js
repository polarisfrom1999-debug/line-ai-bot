'use strict';

const contextMemoryService = require('../../context_memory_service');
const mealLogQueryService = require('../../meal_log_query_service');
const mealCaptureRepository = require('../../../repositories/meal_capture_repository');

function normalizeText(value) {
  return String(value || '').trim();
}

function detectMealCorrectionIntent(safe) {
  if (/麺.*ゼロ|ゼロカロリー|0kcal|0 kcal|この麺はゼロ/.test(safe)) return 'set_component_zero';
  if (/半分食べた|一部だけ食べた|半分だけ/.test(safe)) return 'set_component_fraction';
  if (/食べてない|食べなかった|この麺は食べてない/.test(safe)) return 'mark_component_not_eaten';
  if (/再計算|再計算して|計算し直し|recalc/.test(safe)) return 'recalc_meal';
  if (/削除して|消して/.test(safe)) return 'delete_entire_record';
  if (/昨日の食事|昨日にして|昨晩の分/.test(safe)) return 'relocate_entire_record';
  if (/カロリーは\?|夕食のカロリー|最後の食事のカロリー/.test(safe)) return 'ask_component_kcal';
  return '';
}

function extractComponentName(safe) {
  const hit = (safe || '').match(/([^\s、。]+)\s*(だけ|は|を)?\s*(ゼロ|0kcal|0 kcal|食べてない|半分)/);
  return normalizeText(hit?.[1] || '');
}

async function appendCorrectionEvent(userId, payload = {}) {
  const latest = await mealCaptureRepository.getLatestMealCaptureSession(userId);
  if (!latest?.id) return false;
  const res = await mealCaptureRepository.appendMealCaptureEvent({
    sessionId: latest.id,
    userId,
    eventKind: 'correction',
    payload,
  }).catch(() => ({ ok: false }));
  return Boolean(res?.ok);
}

async function buildTodayTotals(userId) {
  const today = contextMemoryService.getTokyoTodayYmd();
  const rows = await mealLogQueryService.getMealLogsByDateRange(userId, today, today);
  const agg = mealLogQueryService.aggregateMealLogs(rows);
  return { count: Number(agg?.count || 0), kcal: Number(agg?.kcal || 0) };
}

async function resolveMealFollowupFromSession({ input, text, activeContext }) {
  const safe = normalizeText(text || input?.rawText || '');
  if (!safe || !/^meal_/.test(normalizeText(activeContext?.type || ''))) return null;
  const intent = detectMealCorrectionIntent(safe);
  if (!intent) return null;
  console.info('[v2-followup] correction_intent_resolved', { userId: input.userId, intent, text: safe.slice(0, 80) });

  if (intent === 'set_component_zero' || intent === 'mark_component_not_eaten') {
    const componentName = extractComponentName(safe);
    const res = await contextMemoryService.adjustLastMealNutrition(input.userId, {
      mode: componentName ? 'component_zero' : 'set_zero',
      componentName
    }).catch((error) => ({ ok: false, reason: error?.message || 'adjust_exception' }));
    if (!res?.ok) return { intentType: 'meal_followup_correction', replyText: '補正対象の食事を特定できませんでした。' };
    await appendCorrectionEvent(input.userId, {
      correction: 'component_zero',
      componentName: componentName || '',
      before: res.before || {},
      after: res.after || {},
      reason: 'followup_component_zero'
    });
    const totals = await buildTodayTotals(input.userId);
    return {
      intentType: 'meal_followup_correction',
      replyText: componentName
        ? `「${componentName}」のみ0kcal補正しました。他の要素は維持しています。今日の合計は ${totals.count}件 / 約${totals.kcal.toFixed(1)} kcal です。`
        : `対象食事を0kcal補正しました。今日の合計は ${totals.count}件 / 約${totals.kcal.toFixed(1)} kcal です。`
    };
  }
  if (intent === 'set_component_fraction') {
    const componentName = extractComponentName(safe);
    const res = await contextMemoryService.adjustLastMealNutrition(input.userId, {
      mode: componentName ? 'component_ratio' : 'partial',
      ratio: 0.5,
      componentName
    }).catch((error) => ({ ok: false, reason: error?.message || 'adjust_exception' }));
    if (!res?.ok) return { intentType: 'meal_followup_correction', replyText: '補正対象の食事を特定できませんでした。' };
    await appendCorrectionEvent(input.userId, {
      correction: 'component_ratio',
      ratio: 0.5,
      componentName: componentName || '',
      before: res.before || {},
      after: res.after || {},
      reason: 'followup_component_half'
    });
    const totals = await buildTodayTotals(input.userId);
    return {
      intentType: 'meal_followup_correction',
      replyText: componentName
        ? `「${componentName}」のみ半量補正しました。今日の合計は ${totals.count}件 / 約${totals.kcal.toFixed(1)} kcal です。`
        : `対象食事を半量補正しました。今日の合計は ${totals.count}件 / 約${totals.kcal.toFixed(1)} kcal です。`
    };
  }
  if (intent === 'recalc_meal') {
    const totals = await buildTodayTotals(input.userId);
    return {
      intentType: 'meal_followup_correction',
      replyText: `再計算しました。今日の合計は ${totals.count}件 / 約${totals.kcal.toFixed(1)} kcal です。`
    };
  }
  if (intent === 'ask_component_kcal') {
    const today = contextMemoryService.getTokyoTodayYmd();
    const rows = await mealLogQueryService.getMealLogsByDateRange(input.userId, today, today);
    const latest = (Array.isArray(rows) ? rows : [])[0] || null;
    if (!latest) return { intentType: 'meal_followup_correction', replyText: '直近の食事記録が見つかりませんでした。' };
    return { intentType: 'meal_followup_correction', replyText: `直近の食事は約${Number(latest.kcal || 0).toFixed(1)} kcalです。` };
  }
  // delete/relocate は既存 correction resolver へ委譲（意図を固定して再解釈しない）
  if (intent === 'delete_entire_record' || intent === 'relocate_entire_record') {
    return { intentType: 'meal_followup_route_to_correction', replyText: '' };
  }
  return null;
}

module.exports = {
  resolveMealFollowupFromSession,
  detectMealCorrectionIntent,
};
