'use strict';

const mealRecalcRepository = require('../../repositories/meal_recalc_repository');
const { recalcMealStateWithLog } = require('../meal_recalc_engine_service');
const phaseeReachabilityService = require('../phasee_reachability_service');
const contextMemoryService = require('../context_memory_service');
const dailyBalanceQuery = require('../daily_balance_query_service');
const weeklyBalanceQuery = require('../weekly_balance_query_service');
const responseBuilderService = require('./response_builder_service');

const WEEK_BALANCE_INTENTS = new Set(['week_summary', 'week_balance', 'week_intake']);
const DAY_BALANCE_INTENTS = new Set(['today_meal_detail', 'today_total', 'today_balance', 'today_intake', 'today_activity', 'yesterday_total', 'yesterday_balance']);

function normalizeText(value) {
  return String(value || '').trim();
}

function detectMealCorrectionIntent(safe) {
  if (/麺.*ゼロ|ゼロカロリー|0kcal|0 kcal|この麺はゼロ/.test(safe)) return 'set_component_zero';
  if (/半分食べた|一部だけ食べた|半分だけ|半分食べました|半分だけ食べた/.test(safe)) return 'set_component_fraction';
  if (/食べてない|食べなかった|この麺は食べてない/.test(safe)) return 'mark_component_not_eaten';

  if (/(今週|週間|この(一|1)週間|直近(7|７)日(間)?).*(収支|出納|カロリーの?収支)/.test(safe) || /(週間(の|は|って)?(収支|出納|バランス))/.test(safe)) {
    return 'week_balance';
  }
  if (/(今週|週間|この(一|1)週間|直近(7|７)日(間)?).*(食べ(た|る|ます|ました|ましたか|ますか)?(の|量|分|くらい|か|？|ですか|だっけ|だっ|でした|です)?|何(を)?(食べ|食事(を)?(した|して|します|食べ(た|る|ている)?(の|？|か|))?)?.*(くらい|量|分|？|いくら|何キロ|キロ|kcal|ｋｃａｌ)|食事(量|の?量|の合計|のうち|は|を)?(くらい|いくら|どれ|？)|摂取(量|は|し(た|て|ます|ました)?)?(くらい|いくら|どれ|か|？|ですか|だっけ|だっ|でした)?|ど(の|な)くらい.*(食|食事|キロ|カロリー|kcal|ｋｃａｌ))/.test(
    safe
  ) || /(週間(で|の)?(は|、)?(食|食事|何を食|摂取(し|量)))/.test(safe)) {
    return 'week_intake';
  }
  if (
    /(週間報告|週(の|間)?(報告|まとめ|サマリ|サマリー|ふり返(り|ります|った)?|振り(返|返)(る|り|い)?|レポート|状況)|今週(の|は|って)?(まとめ|サマリ|サマリー|ふり返(り|る)?|振り(返|返)(る|るの)?|どう(だっ(た|け)|でした(か|)|ですか(。|)|？)|状況|所見|だいたい(どう(だった|だ|ですか|か)?)?)|7日(間|分|ぶり)?(の|は|で|って)?(まとめ|報告|ふり返(り|る)?|振り(返|返)(る|り|い)?|サマリ|サマリー|状況(は|の|のあたり|どう(だった|だ|です|か|？))|はどう)|直近(7|７)日(間|ぶり)?(の|は|で|って|のあたり)?(まとめ|報告|ふり返(り|る)?|振り(返|返)(る|るの)?|サマリ|サマリー|状況(は|の|どう(だった|だ|です|か|？))|[のは]どう(だった|だ|です|か|？|)))|今週(、|。)?(全体|ざっと|ざっくり)(の?あたり|の|の状況|の感じ(は|？|？)?)?(は|？|？)?|今週(、|。)?(どう(だった|だ(っ(た|け))?|でした(か|)|です(か|)|の感じ(は|？)?)?$)/.test(
      safe
    ) ||
    /(今週$|週(間|の)で(、|。)?$)/.test(safe)
  ) {
    return 'week_summary';
  }

  if (/(今日|本日).*(収支|出納|カロリーの?収支)/.test(safe)) return 'today_balance';
  if (/(今日|本日).*(合計|トータル|総(摂取|カロリー|カロリ)|日次(合計)?|カロリーの?合計|合計カロリー|摂取の?合計)/.test(safe)) return 'today_total';
  if (/(昨日|きのう).*(収支|出納|カロリーの?収支)/.test(safe)) return 'yesterday_balance';
  if (/(昨日|きのう).*(合計|トータル|総(摂取|カロリー|カロリ)|日次(合計)?|カロリーの?合計|合計カロリー|摂取の?合計)/.test(safe)) return 'yesterday_total';
  if (/(今日|本日)の?カロリー(は|の|って|だっけ|って|いくら)?(？|ですか|だっけ|\?)?\s*$/i.test(safe)) {
    return 'today_total';
  }
  if (
    /(今日|本日).{0,12}運動(量|は|の|を|した|して|しました|します|ログ|記録|した|してきた)?(の|は|を|いくら|くらい|どれ|ですか|だっけ|ますか|ましたか|して)?[？\?]?\s*$/i.test(
      safe
    ) &&
    !/(合計|収支|食べ(た|る|ます|ました|です)|何.*食べ|食事(の|は|)(量|合計|詳細|内訳|一覧)|摂取(量|は|した|します|しますか)|合計|トータル|総(摂取|カロリー|カロリ))/.test(
      safe
    )
  ) {
    return 'today_activity';
  }
  if (/(今日|本日).*(ど(の|な)くらい|いくら|何(を)?).*(食べ(た|る|ます|ました|ますか)?(の|量|分|くらい|か|？|ですか|だっけ)?|何.*食べ(た|る)|食事(の量|量|の量は|の合計|は|を)?(くらい|いくら|どれ)|摂取(量|は|した|します)?(くらい|どれ|いくら)?|キロ(カロリー|kcal|ｋｃａｌ))/.test(safe)) {
    return 'today_intake';
  }
  if (/(今日|本日).*(ど(の|な)くらい|いくら|何(歩|分|キロ)?).*(動(いた|き|きた|ます|ました)?(の|量|分|くらい|か|？|ですか|だっけ)?|運動(量|は|を|した|して|します|しました)?(の|くらい|どれ|いくら|か|？)?|歩(いた|数|行|き|いて)?(の|量|分|くらい|か|？)?|活動(量|量は|消費|した|します)?(くらい|どれ|いくら|か|？)?|活動(記録|ログ)?|走(った|る)?|走行|泳(い)?(だ|ぎ|ぐ)?(くらい)?|スイム)/.test(
    safe
  )) {
    return 'today_activity';
  }
  if (/今日.*(食事|詳細|内訳)|詳細一覧|食事詳細/.test(safe)) return 'today_meal_detail';
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

function buildSpecificDayTotalReply(dayBalance) {
  if (!dayBalance?.mealCount) {
    return `🍚 ${dayBalance?.dateYmd || '対象日'}（東京日付）の食事はまだ記録がありません。合計 0 kcal です。`;
  }
  return `🍚 ${dayBalance.dateYmd}（東京日付）の合計は、食事${dayBalance.mealCount}件、摂取（再計算反映後）で約${dayBalance.intakeKcal} kcal（P${dayBalance.protein}／F${dayBalance.fat}／C${dayBalance.carbs}）です。補正の適用は合計${dayBalance.totalCorrectionEventCount}件分です。`;
}

function buildSpecificDayBalanceReply(dayBalance) {
  const d = String(dayBalance?.dateYmd || '').trim();
  return `⚖️ ${d || '対象日'}（東京日付）の収支は、食事（再計算後）の摂取が約${dayBalance?.intakeKcal || 0} kcal、活動消費が約${dayBalance?.activityKcal || 0} kcal（活動${dayBalance?.activityCount || 0}件）で、差分（摂取−活動）が約${dayBalance?.netKcal || 0} kcal です。合計補正イベント${dayBalance?.totalCorrectionEventCount || 0}件。`;
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
    createdByFlow: 'newflow_meal_correction',
  }).catch(() => ({ ok: false }));
  return Boolean(res?.ok);
}

async function resolveMealBundle(mealId, userId) {
  const id = Number(mealId || 0);
  if (id > 0) return mealRecalcRepository.getBaseMealWithEvents(id);
  const latest = await mealRecalcRepository.getLatestBaseMealByUser(userId);
  if (!latest?.id) return null;
  return mealRecalcRepository.getBaseMealWithEvents(latest.id);
}

/**
 * 補正後の日次合計等（日次正本 query と同じ集計）
 * @returns {Promise<{ count: number, kcal: number, protein: number, fat: number, carbs: number, details: object[] }>}
 */
async function computeTodayRollup(userId) {
  const b = await dailyBalanceQuery.getTokyoDayEnergyBalance(String(userId), null);
  if (!b) return { count: 0, kcal: 0, protein: 0, fat: 0, carbs: 0, details: [] };
  return {
    count: b.mealCount,
    kcal: b.intakeKcal,
    protein: b.protein,
    fat: b.fat,
    carbs: b.carbs,
    details: (b.details || []).map((d) => ({
      mealId: d.mealId,
      label: d.label,
      kcal: d.kcal,
      protein: d.protein,
      fat: d.fat,
      carbs: d.carbs,
      eventCount: d.eventCount,
      itemList: Array.isArray(d.itemList) ? d.itemList : [],
    })),
  };
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
    phaseeReachabilityService
      .recordReachability('newflow_meal_correction_reached', ['services/newflow/meal_correction_service.js'], {
        userId: input?.userId || '',
        intent,
        text: safe.slice(0, 60),
      })
      .catch(() => null);
  } else {
    return null;
  }
  console.info('[newflow-followup] meal_correction_intent', { userId: input.userId, intent, text: safe.slice(0, 80) });

  if (WEEK_BALANCE_INTENTS.has(intent)) {
    const w = await weeklyBalanceQuery.getTokyoWeekEnergyBalance(String(input.userId), null);
    if (intent === 'week_summary') {
      return { intentType: 'newflow_meal_correction', replyText: responseBuilderService.buildWeekSummaryReply(w) };
    }
    if (intent === 'week_balance') {
      return { intentType: 'newflow_meal_correction', replyText: responseBuilderService.buildWeekBalanceReply(w) };
    }
    if (intent === 'week_intake') {
      return { intentType: 'newflow_meal_correction', replyText: responseBuilderService.buildWeekIntakeAskReply(w) };
    }
  }

  if (DAY_BALANCE_INTENTS.has(intent)) {
    let targetYmd = null;
    if (intent === 'yesterday_total' || intent === 'yesterday_balance') {
      const todayYmd = contextMemoryService.getTokyoTodayYmd();
      targetYmd = contextMemoryService.addCalendarDaysToTokyoYmd(todayYmd, -1);
    }
    const b = await dailyBalanceQuery.getTokyoDayEnergyBalance(String(input.userId), targetYmd || null);
    if (intent === 'today_total') {
      return { intentType: 'newflow_meal_correction', replyText: responseBuilderService.buildTodayMealTotalReply(b) };
    }
    if (intent === 'today_balance') {
      return { intentType: 'newflow_meal_correction', replyText: responseBuilderService.buildTodayBalanceReply(b) };
    }
    if (intent === 'today_intake') {
      return { intentType: 'newflow_meal_correction', replyText: responseBuilderService.buildTodayIntakeAskReply(b) };
    }
    if (intent === 'today_activity') {
      return { intentType: 'newflow_meal_correction', replyText: responseBuilderService.buildTodayActivityAskReply(b) };
    }
    if (intent === 'yesterday_total') {
      return { intentType: 'newflow_meal_correction', replyText: buildSpecificDayTotalReply(b) };
    }
    if (intent === 'yesterday_balance') {
      return { intentType: 'newflow_meal_correction', replyText: buildSpecificDayBalanceReply(b) };
    }
    if (intent === 'today_meal_detail') {
      if (!b?.mealCount) return { intentType: 'newflow_meal_correction', replyText: '今日の食事詳細はまだありません。' };
      const lines = b.details
        .slice(0, 5)
        .map((d, idx) => `${idx + 1}. ${d.label}: ${Number(d.kcal).toFixed(1)} kcal (P${Number(d.protein).toFixed(1)}/F${Number(d.fat).toFixed(1)}/C${Number(d.carbs).toFixed(1)}) event:${d.eventCount}`);
      return { intentType: 'newflow_meal_correction', replyText: `今日の食事詳細です。\n${lines.join('\n')}` };
    }
  }

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
        : `対象食事を0kcal補正しました。補正後は約${Number(recalced?.kcal || 0).toFixed(1)} kcal（event ${Number(recalced?.event_count || 0)}件適用）です。今日の合計は ${totals.count}件 / 約${totals.kcal.toFixed(1)} kcal です。`,
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
        : `対象食事を半量補正しました。補正後は約${Number(recalced?.kcal || 0).toFixed(1)} kcal（event ${Number(recalced?.event_count || 0)}件適用）です。今日の合計は ${totals.count}件 / 約${totals.kcal.toFixed(1)} kcal です。`,
    };
  }
  if (intent === 'recalc_meal') {
    const updatedBundle = await resolveMealBundle(targetMealId, input.userId);
    const recalced = recalcMealStateWithLog(updatedBundle || {}, { userId: input.userId });
    const totals = await computeTodayRollup(input.userId);
    return {
      intentType: 'newflow_meal_correction',
      replyText: `再計算しました。直近食事は約${Number(recalced?.kcal || 0).toFixed(1)} kcal（event ${Number(recalced?.event_count || 0)}件適用）、今日の合計は ${totals.count}件 / 約${totals.kcal.toFixed(1)} kcal です。`,
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
  detectMealCorrectionIntent,
};
