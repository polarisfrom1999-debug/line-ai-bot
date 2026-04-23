'use strict';

const contextMemoryService = require('../context_memory_service');
const mealRecalcRepository = require('../../repositories/meal_recalc_repository');
const { recalcMealStateWithLog } = require('../meal_recalc_engine_service');
const phaseeReachabilityService = require('../phasee_reachability_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function detectMealCorrectionIntent(safe) {
  if (/麺.*ゼロ|ゼロカロリー|0kcal|0 kcal|この麺はゼロ/.test(safe)) return 'set_component_zero';
  if (/半分食べた|一部だけ食べた|半分だけ|半分食べました|半分だけ食べた/.test(safe)) return 'set_component_fraction';
  if (/食べてない|食べなかった|この麺は食べてない/.test(safe)) return 'mark_component_not_eaten';
  if (/今日.*(食事|詳細|内訳)|詳細一覧|食事詳細/.test(safe)) return 'today_meal_detail';
  if (/今日.*(合計|トータル)|日次合計|総摂取|合計カロリー/.test(safe)) return 'today_total';
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
  const mealId = Number(payload?.mealId || 0);
  if (!mealId) return false;
  const dedupeSeed = normalizeText(payload?.dedupeSeed || `${mealId}:${payload?.eventType || 'event'}`);
  const res = await mealRecalcRepository.appendCorrectionEvent({
    mealId,
    userId,
    eventType: normalizeText(payload?.eventType || 'manual_adjust'),
    payloadJson: payload?.payloadJson || {},
    priority: Number(payload?.priority || 3),
    timestamp: normalizeText(payload?.timestamp || new Date().toISOString()),
    dedupeKey: dedupeSeed,
    sourceMessageId: normalizeText(payload?.sourceMessageId || ''),
    createdByFlow: 'newflow_meal_correction'
  }).catch(() => ({ ok: false }));
  return Boolean(res?.ok);
}

function buildTokyoRangeIso(ymd) {
  const day = normalizeText(ymd);
  if (!day) return { fromIso: '', toIso: '' };
  const fromIso = new Date(`${day}T00:00:00+09:00`).toISOString();
  const toIso = new Date(new Date(`${day}T00:00:00+09:00`).getTime() + (24 * 60 * 60 * 1000)).toISOString();
  return { fromIso, toIso };
}

async function resolveMealBundle(mealId, userId) {
  const id = Number(mealId || 0);
  if (id > 0) return mealRecalcRepository.getBaseMealWithEvents(id);
  const latest = await mealRecalcRepository.getLatestBaseMealByUser(userId);
  if (!latest?.id) return null;
  return mealRecalcRepository.getBaseMealWithEvents(latest.id);
}

async function computeTodayRollup(userId) {
  const today = contextMemoryService.getTokyoTodayYmd();
  const range = buildTokyoRangeIso(today);
  const meals = await mealRecalcRepository.getBaseMealsByDateRange(userId, range.fromIso, range.toIso);
  let kcal = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;
  const details = [];
  for (const meal of (Array.isArray(meals) ? meals : [])) {
    const bundle = await mealRecalcRepository.getBaseMealWithEvents(meal.id);
    if (!bundle?.meal) continue;
    const state = recalcMealStateWithLog(bundle, { userId });
    kcal += Number(state.kcal || 0);
    protein += Number(state.protein || 0);
    fat += Number(state.fat || 0);
    carbs += Number(state.carbs || 0);
    details.push({
      mealId: Number(meal.id || 0),
      label: normalizeText(bundle?.meal?.meal_label || '食事'),
      kcal: Number(state.kcal || 0),
      protein: Number(state.protein || 0),
      fat: Number(state.fat || 0),
      carbs: Number(state.carbs || 0),
      eventCount: Number(state.event_count || 0),
      itemList: Array.isArray(state.item_list) ? state.item_list : []
    });
  }
  return { count: details.length, kcal, protein, fat, carbs, details };
}

/**
 * 食事画像セッション中の補正・照会（newflow 専用。旧 v2 経路とは共有しない）
 */
async function resolveMealFollowupFromSession({ input, text, activeContext } = {}) {
  const safe = normalizeText(text || input?.rawText || '');
  if (!safe || !/^meal_/.test(normalizeText(activeContext?.type || ''))) return null;

  const intent = detectMealCorrectionIntent(safe);
  if (intent) {
    console.info('[phasee-new] newflow_meal_correction_reached', { userId: input?.userId || '', intent, text: safe.slice(0, 60) });
    phaseeReachabilityService.recordReachability('newflow_meal_correction_reached', ['services/newflow/meal_correction_service.js'], {
      userId: input?.userId || '',
      intent,
      text: safe.slice(0, 60)
    }).catch(() => null);
  } else {
    return null;
  }
  console.info('[newflow-followup] meal_correction_intent', { userId: input.userId, intent, text: safe.slice(0, 80) });

  const mealIdFromContext = Number(activeContext?.payload?.baseMealId || 0);
  const baseBundle = await resolveMealBundle(mealIdFromContext, input.userId);
  if (!baseBundle?.meal?.id) {
    return { intentType: 'newflow_meal_correction', replyText: '補正対象の食事を特定できませんでした。' };
  }
  const targetMealId = Number(baseBundle.meal.id || 0);

  if (intent === 'set_component_zero' || intent === 'mark_component_not_eaten') {
    const componentName = extractComponentName(safe);
    await appendCorrectionEvent(input.userId, {
      mealId: targetMealId,
      eventType: componentName ? 'remove_component' : 'remove_all',
      payloadJson: componentName
        ? { itemName: componentName, removeAll: false }
        : { removeAll: true },
      priority: 1,
      timestamp: new Date().toISOString(),
      dedupeSeed: normalizeText(input?.messageId ? `msg:${input.messageId}:remove` : `meal:${targetMealId}:remove`),
      sourceMessageId: normalizeText(input?.messageId || ''),
    });
    const updatedBundle = await resolveMealBundle(targetMealId, input.userId);
    const recalced = recalcMealStateWithLog(updatedBundle || {}, { userId: input.userId });
    const totals = await computeTodayRollup(input.userId);
    return {
      intentType: 'newflow_meal_correction',
      replyText: componentName
        ? `「${componentName}」のみ0kcal補正しました。補正後は約${Number(recalced?.kcal || 0).toFixed(1)} kcal（event ${Number(recalced?.event_count || 0)}件適用）です。今日の合計は ${totals.count}件 / 約${totals.kcal.toFixed(1)} kcal です。`
        : `対象食事を0kcal補正しました。補正後は約${Number(recalced?.kcal || 0).toFixed(1)} kcal（event ${Number(recalced?.event_count || 0)}件適用）です。今日の合計は ${totals.count}件 / 約${totals.kcal.toFixed(1)} kcal です。`
    };
  }
  if (intent === 'set_component_fraction') {
    const componentName = extractComponentName(safe);
    await appendCorrectionEvent(input.userId, {
      mealId: targetMealId,
      eventType: 'portion_ratio',
      payloadJson: { ratio: 0.5, itemName: componentName || '' },
      priority: 2,
      timestamp: new Date().toISOString(),
      dedupeSeed: normalizeText(input?.messageId ? `msg:${input.messageId}:portion` : `meal:${targetMealId}:portion`),
      sourceMessageId: normalizeText(input?.messageId || ''),
    });
    const updatedBundle = await resolveMealBundle(targetMealId, input.userId);
    const recalced = recalcMealStateWithLog(updatedBundle || {}, { userId: input.userId });
    const totals = await computeTodayRollup(input.userId);
    return {
      intentType: 'newflow_meal_correction',
      replyText: componentName
        ? `「${componentName}」を半量補正しました。補正後は約${Number(recalced?.kcal || 0).toFixed(1)} kcal（event ${Number(recalced?.event_count || 0)}件適用）です。今日の合計は ${totals.count}件 / 約${totals.kcal.toFixed(1)} kcal です。`
        : `対象食事を半量補正しました。補正後は約${Number(recalced?.kcal || 0).toFixed(1)} kcal（event ${Number(recalced?.event_count || 0)}件適用）です。今日の合計は ${totals.count}件 / 約${totals.kcal.toFixed(1)} kcal です。`
    };
  }
  if (intent === 'today_meal_detail') {
    const totals = await computeTodayRollup(input.userId);
    if (!totals.count) return { intentType: 'newflow_meal_correction', replyText: '今日の食事詳細はまだありません。' };
    const lines = totals.details
      .slice(0, 5)
      .map((d, idx) => `${idx + 1}. ${d.label}: ${d.kcal.toFixed(1)} kcal (P${d.protein.toFixed(1)}/F${d.fat.toFixed(1)}/C${d.carbs.toFixed(1)}) event:${d.eventCount}`);
    return { intentType: 'newflow_meal_correction', replyText: `今日の食事詳細です。\n${lines.join('\n')}` };
  }
  if (intent === 'today_total') {
    const totals = await computeTodayRollup(input.userId);
    return {
      intentType: 'newflow_meal_correction',
      replyText: `今日の合計は ${totals.count}件 / ${totals.kcal.toFixed(1)} kcal (P${totals.protein.toFixed(1)}/F${totals.fat.toFixed(1)}/C${totals.carbs.toFixed(1)}) です。`
    };
  }
  if (intent === 'recalc_meal') {
    const updatedBundle = await resolveMealBundle(targetMealId, input.userId);
    const recalced = recalcMealStateWithLog(updatedBundle || {}, { userId: input.userId });
    const totals = await computeTodayRollup(input.userId);
    return {
      intentType: 'newflow_meal_correction',
      replyText: `再計算しました。直近食事は約${Number(recalced?.kcal || 0).toFixed(1)} kcal（event ${Number(recalced?.event_count || 0)}件適用）、今日の合計は ${totals.count}件 / 約${totals.kcal.toFixed(1)} kcal です。`
    };
  }
  if (intent === 'ask_component_kcal') {
    const updatedBundle = await resolveMealBundle(targetMealId, input.userId);
    const recalced = recalcMealStateWithLog(updatedBundle || {}, { userId: input.userId });
    if (!updatedBundle?.meal?.id) return { intentType: 'newflow_meal_correction', replyText: '直近の食事記録が見つかりませんでした。' };
    return { intentType: 'newflow_meal_correction', replyText: `直近の食事は約${Number(recalced?.kcal || 0).toFixed(1)} kcalです。` };
  }
  if (intent === 'delete_entire_record' || intent === 'relocate_entire_record') {
    return { intentType: 'newflow_meal_route_to_correction', replyText: '' };
  }
  return null;
}

module.exports = {
  resolveMealFollowupFromSession,
  detectMealCorrectionIntent
};
