'use strict';

const assert = require('assert');
const { aggregateWeekFromDayRows } = require('../services/weekly_balance_query_service');

/**
 * 活動あり日を含む7日分の仮想スナップショット（DB不要）
 */
function run() {
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const y = `2026-04-${String(18 + i).padStart(2, '0')}`;
    days.push({
      dateYmd: y,
      intakeKcal: i === 2 ? 200 : 0,
      activityKcal: i === 2 ? 200 : 0,
      netKcal: 0,
      mealCount: i === 1 || i === 2 ? 1 : 0,
      totalCorrectionEventCount: i === 2 ? 2 : 0,
      activityCount: i === 2 ? 2 : 0
    });
  }
  const w = aggregateWeekFromDayRows(days, days[0].dateYmd, days[6].dateYmd);
  assert.strictEqual(w.dayCount, 7, '7 days');
  assert.strictEqual(w.totals.weekIntakeKcal, 200, 'week intake');
  assert.strictEqual(w.totals.weekActivityKcal, 200, 'week activity from one day with rows');
  assert.strictEqual(w.totals.weekNetKcal, 0, 'week net');
  assert.strictEqual(w.totals.weekMealCount, 2, 'meals on 2 days');
  assert.strictEqual(w.totals.weekCorrectionEventCount, 2, 'corrections on active day');
  assert.strictEqual(w.totals.weekActivityRowCount, 2, 'activity rows on active day');
  const mid = w.days[2];
  assert.strictEqual(mid.intakeKcal, 200);
  assert.strictEqual(mid.activityKcal, 200);
  assert.strictEqual(mid.activityCount, 2);
  assert(w.averages.avgIntakeKcal >= 28.5 && w.averages.avgIntakeKcal <= 28.6, 'avg intake ~28.6');
  console.log('weekly_activity_fixture_test: ok', {
    fromYmd: w.fromYmd,
    toYmd: w.toYmd,
    weekActivity: w.totals.weekActivityKcal
  });
}

run();
