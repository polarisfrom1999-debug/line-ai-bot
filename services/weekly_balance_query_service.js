'use strict';

const contextMemoryService = require('./context_memory_service');
const dailyBalanceQuery = require('./daily_balance_query_service');

const { round1 } = dailyBalanceQuery;

/**
 * 日次スナップショット配列（getTokyoDayEnergyBalance 相当）から週合計を純粋集計（テスト用）
 * @param {object[]} dayRows 各日 { intakeKcal, activityKcal, netKcal, mealCount, totalCorrectionEventCount, activityCount, dateYmd? }
 * @param {string} [fromYmd]
 * @param {string} [toYmd]
 */
function aggregateWeekFromDayRows(dayRows, fromYmd = '', toYmd = '') {
  const days = (Array.isArray(dayRows) ? dayRows : []).map((d) => ({
    dateYmd: String(d?.dateYmd || ''),
    intakeKcal: round1(Number(d?.intakeKcal || 0)),
    activityKcal: round1(Number(d?.activityKcal || 0)),
    netKcal: round1(Number(d?.netKcal != null ? d.netKcal : Number(d?.intakeKcal || 0) - Number(d?.activityKcal || 0))),
    mealCount: Number(d?.mealCount || 0) || 0,
    correctionEventCount: Number(d?.totalCorrectionEventCount != null ? d.totalCorrectionEventCount : d?.correctionEventCount || 0) || 0,
    activityCount: Number(d?.activityCount || 0) || 0
  }));
  const n = days.length;
  const denom = n > 0 ? n : 1;
  let weekIntake = 0;
  let weekActivity = 0;
  let weekMeals = 0;
  let weekCorrections = 0;
  let weekActivityRows = 0;
  for (const d of days) {
    weekIntake += d.intakeKcal;
    weekActivity += d.activityKcal;
    weekMeals += d.mealCount;
    weekCorrections += d.correctionEventCount;
    weekActivityRows += d.activityCount;
  }
  const weekNet = round1(weekIntake - weekActivity);
  return {
    fromYmd: fromYmd || (days[0]?.dateYmd || ''),
    toYmd: toYmd || (days[days.length - 1]?.dateYmd || ''),
    dayCount: n,
    days,
    totals: {
      weekIntakeKcal: round1(weekIntake),
      weekActivityKcal: round1(weekActivity),
      weekNetKcal: weekNet,
      weekMealCount: weekMeals,
      weekCorrectionEventCount: weekCorrections,
      weekActivityRowCount: weekActivityRows
    },
    averages: {
      avgIntakeKcal: round1(weekIntake / denom),
      avgActivityKcal: round1(weekActivity / denom),
      avgNetKcal: round1(weekNet / denom)
    }
  };
}

/**
 * 直近7日（東京、終端日を含む7日分）— 各日は日次正本 getTokyoDayEnergyBalance
 * @param {string} userId
 * @param {string} [endYmd] 省略時は東京本日
 */
async function getTokyoWeekEnergyBalance(userId, endYmd) {
  const end = String(endYmd || contextMemoryService.getTokyoTodayYmd() || '').trim();
  if (!String(userId || '').trim() || !end) return null;
  const startYmd = contextMemoryService.addCalendarDaysToTokyoYmd(end, -6);
  if (!startYmd) return null;

  const dayPromises = [];
  for (let i = 0; i < 7; i += 1) {
    const ymd = contextMemoryService.addCalendarDaysToTokyoYmd(startYmd, i);
    if (!ymd) continue;
    dayPromises.push(
      dailyBalanceQuery.getTokyoDayEnergyBalance(String(userId), ymd, { skipDailyLog: true })
    );
  }
  const raw = await Promise.all(dayPromises);
  const dayRows = [];
  for (const d of raw) {
    if (!d) continue;
    dayRows.push({
      dateYmd: d.dateYmd,
      intakeKcal: d.intakeKcal,
      activityKcal: d.activityKcal,
      netKcal: d.netKcal,
      mealCount: d.mealCount,
      totalCorrectionEventCount: d.totalCorrectionEventCount,
      activityCount: d.activityCount
    });
  }
  if (dayRows.length !== 7) {
    return null;
  }
  const payload = aggregateWeekFromDayRows(dayRows, startYmd, end);
  console.info('[phasee-new] weekly_balance_context', {
    userId: String(userId),
    fromYmd: payload.fromYmd,
    toYmd: payload.toYmd,
    dayCount: 7,
    weekTotalIntake: payload.totals.weekIntakeKcal,
    weekTotalActivity: payload.totals.weekActivityKcal,
    weekTotalNet: payload.totals.weekNetKcal,
    perDay: payload.days.map((x) => ({
      dateYmd: x.dateYmd,
      mealCount: x.mealCount,
      activityCount: x.activityCount,
      intakeKcal: x.intakeKcal,
      activityKcal: x.activityKcal,
      netKcal: x.netKcal,
      correctionEventCount: x.correctionEventCount
    }))
  });
  return payload;
}

module.exports = {
  getTokyoWeekEnergyBalance,
  aggregateWeekFromDayRows
};
