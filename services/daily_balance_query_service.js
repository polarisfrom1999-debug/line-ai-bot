'use strict';

const contextMemoryService = require('./context_memory_service');
const mealRecalcRepository = require('../repositories/meal_recalc_repository');
const activityLogRepository = require('../repositories/activity_log_repository');
const { recalcMealStateWithLog } = require('./meal_recalc_engine_service');

function round1(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 10) / 10;
}

function buildTokyoRangeIso(ymd) {
  const day = String(ymd || '').trim();
  if (!day) return { fromIso: '', toIso: '' };
  const fromIso = new Date(`${day}T00:00:00+09:00`).toISOString();
  const toIso = new Date(new Date(`${day}T00:00:00+09:00`).getTime() + (24 * 60 * 60 * 1000)).toISOString();
  return { fromIso, toIso };
}

/**
 * 東京日付1日分の 摂取(再計算) / 運動消費 / 収支
 * 食事: base_meals 該当日内 + correction_events 適用後 (recalcMealStateWithLog)
 * 運動: activity_logs 該当日内の estimated_activity_kcal 合計
 *
 * @param {string} userId
 * @param {string} [dateYmd] 省略時は東京本日
 * @returns {Promise<{
 *   dateYmd: string,
 *   fromIso: string, toIso: string,
 *   mealCount: number, intakeKcal: number, protein: number, fat: number, carbs: number,
 *   totalCorrectionEventCount: number,
 *   activityKcal: number, activityCount: number,
 *   netKcal: number,
 *   details: object[]
 * } | null>}
 */
async function getTokyoDayEnergyBalance(userId, dateYmd) {
  const day = String(dateYmd || contextMemoryService.getTokyoTodayYmd() || '').trim();
  if (!String(userId || '').trim() || !day) return null;
  const { fromIso, toIso } = buildTokyoRangeIso(day);
  if (!fromIso || !toIso) return null;

  const meals = await mealRecalcRepository.getBaseMealsByDateRange(String(userId), fromIso, toIso);
  let intakeKcal = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;
  let totalCorrectionEventCount = 0;
  const details = [];
  for (const meal of Array.isArray(meals) ? meals : []) {
    const bundle = await mealRecalcRepository.getBaseMealWithEvents(meal.id);
    if (!bundle?.meal) continue;
    const state = recalcMealStateWithLog(bundle, { userId: String(userId) });
    const evn = Number(state?.event_count || 0) || 0;
    const kc = Number(state.kcal || 0);
    const pr = Number(state.protein || 0);
    const f = Number(state.fat || 0);
    const c = Number(state.carbs || 0);
    intakeKcal += kc;
    protein += pr;
    fat += f;
    carbs += c;
    totalCorrectionEventCount += evn;
    details.push({
      mealId: Number(meal.id || 0),
      label: String(bundle?.meal?.meal_label || '食事'),
      kcal: round1(kc),
      protein: round1(pr),
      fat: round1(f),
      carbs: round1(c),
      eventCount: evn,
      itemList: Array.isArray(state?.item_list) ? state.item_list : []
    });
  }

  const act = await activityLogRepository.getActivityBurnInRange(String(userId), fromIso, toIso);
  const activityKcal = round1(Number(act?.totalKcal || 0));
  const netKcal = round1(intakeKcal - activityKcal);

  const payload = {
    dateYmd: day,
    fromIso,
    toIso,
    mealCount: details.length,
    intakeKcal: round1(intakeKcal),
    protein: round1(protein),
    fat: round1(fat),
    carbs: round1(carbs),
    totalCorrectionEventCount,
    activityKcal,
    activityCount: Number(act?.rowCount || 0),
    netKcal,
    details
  };
  console.info('[phasee-new] daily_balance_context', {
    userId: String(userId),
    dateYmd: day,
    mealCount: payload.mealCount,
    totalCorrectionEventCount: payload.totalCorrectionEventCount,
    activityCount: payload.activityCount,
    intakeKcal: payload.intakeKcal,
    activityKcal: payload.activityKcal,
    netKcal: payload.netKcal
  });
  return payload;
}

module.exports = {
  getTokyoDayEnergyBalance,
  buildTokyoRangeIso,
  round1
};
