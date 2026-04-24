'use strict';

const contextMemoryService = require('./context_memory_service');
const dailyBalanceQuery = require('./daily_balance_query_service');
const { aggregateWeekFromDayRows } = require('./weekly_balance_query_service');

async function getTokyoMonthEnergyBalance(userId, endYmd) {
  const end = String(endYmd || contextMemoryService.getTokyoTodayYmd() || '').trim();
  if (!String(userId || '').trim() || !end) return null;
  const start = contextMemoryService.addCalendarDaysToTokyoYmd(end, -29);
  if (!start) return null;
  const days = [];
  for (let i = 0; i < 30; i += 1) {
    const ymd = contextMemoryService.addCalendarDaysToTokyoYmd(start, i);
    if (!ymd) continue;
    const d = await dailyBalanceQuery.getTokyoDayEnergyBalance(String(userId), ymd, { skipDailyLog: true });
    if (!d) continue;
    days.push({
      dateYmd: d.dateYmd,
      intakeKcal: d.intakeKcal,
      activityKcal: d.activityKcal,
      netKcal: d.netKcal,
      mealCount: d.mealCount,
      totalCorrectionEventCount: d.totalCorrectionEventCount,
      activityCount: d.activityCount
    });
  }
  if (days.length !== 30) return null;
  const base = aggregateWeekFromDayRows(days, start, end);
  return {
    fromYmd: start,
    toYmd: end,
    dayCount: 30,
    days: base.days,
    totals: {
      monthIntakeKcal: base.totals.weekIntakeKcal,
      monthActivityKcal: base.totals.weekActivityKcal,
      monthNetKcal: base.totals.weekNetKcal,
      monthMealCount: base.totals.weekMealCount,
      monthCorrectionEventCount: base.totals.weekCorrectionEventCount,
      monthActivityRowCount: base.totals.weekActivityRowCount
    },
    averages: {
      avgIntakeKcal: base.averages.avgIntakeKcal,
      avgActivityKcal: base.averages.avgActivityKcal,
      avgNetKcal: base.averages.avgNetKcal
    }
  };
}

module.exports = {
  getTokyoMonthEnergyBalance
};
