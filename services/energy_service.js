'use strict';

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round1(value) {
  return Math.round(normalizeNumber(value) * 10) / 10;
}

function calculateDailyEnergyBalance({ estimatedBmr = 0, estimatedTdee = 0, intakeKcal = 0, activityKcal = 0 }) {
  const tdee = normalizeNumber(estimatedTdee);
  const bmr = normalizeNumber(estimatedBmr);
  const intake = normalizeNumber(intakeKcal);
  const activity = normalizeNumber(activityKcal);
  const totalBurn = round1((tdee || bmr) + activity);
  const balance = round1(intake - totalBurn);
  return { estimated_bmr: round1(bmr), estimated_tdee: round1(tdee), intake_kcal: round1(intake), activity_kcal: round1(activity), total_burn_kcal: totalBurn, balance_kcal: balance };
}

function buildDailyMealSummaryText({ intakeKcal = 0, mealCount = 0, latestMeal = '' } = {}) {
  const lines = [`今日の食事合計は ${Math.round(normalizeNumber(intakeKcal))} kcal 前後です。`];
  if (mealCount) lines.push(`記録数: ${mealCount}件`);
  if (latestMeal) lines.push(`直近の食事: ${latestMeal}`);
  return lines.join('\n');
}

module.exports = {
  calculateDailyEnergyBalance,
  buildDailyMealSummaryText,
};
