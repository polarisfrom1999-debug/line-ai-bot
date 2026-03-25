'use strict';

function round1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function buildPredictionText({ estimatedBmr = 0, estimatedTdee = 0, intakeKcal = 0, activityKcal = 0, currentWeightKg = null }) {
  const tdee = Number(estimatedTdee) || Number(estimatedBmr) || 0;
  const intake = Number(intakeKcal) || 0;
  const activity = Number(activityKcal) || 0;
  const dailyBalance = round1(intake - (tdee + activity));
  const weeklyKg = dailyBalance == null ? null : round1((dailyBalance * 7) / 7200);
  const lines = [
    '今の記録から、ざっくりした見通しを出しますね。',
    `摂取: ${Math.round(intake)} kcal`,
    `活動消費: ${Math.round(activity)} kcal`,
    `推定総消費目安: ${Math.round(tdee)} kcal`,
    `ざっくり収支: ${dailyBalance} kcal/日`,
  ];
  if (weeklyKg != null) lines.push(`この流れが1週間続いた場合の目安: ${weeklyKg > 0 ? '+' : ''}${weeklyKg} kg`);
  if (currentWeightKg != null && weeklyKg != null) lines.push(`今の体重 ${currentWeightKg}kg からみると、1週間後の目安は ${round1(Number(currentWeightKg) + weeklyKg)}kg 前後です。`);
  return { text: lines.join('\n'), quickReplies: ['体重グラフ'] };
}

function isPredictionIntent(text = '') {
  return /(予測|見通し|体重予測|このまま)/.test(String(text || ''));
}

module.exports = {
  buildPredictionText,
  isPredictionIntent,
};
