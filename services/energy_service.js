'use strict';

const { fmt, round1 } = require('../utils/formatters');

function buildEnergySummaryText({ intakeKcal = 0, activityKcal = 0 } = {}) {
  return [
    `今日の食事: ${fmt(intakeKcal)} kcal`,
    `今日の運動消費: ${fmt(activityKcal)} kcal`,
  ].join('\n');
}

function buildExerciseAnswer({ summary = '', minutes = null, kcal = null } = {}) {
  const lines = ['運動を記録しました。'];
  if (summary) lines.push(`内容: ${summary}`);
  if (minutes != null) lines.push(`時間: ${fmt(minutes)}分`);
  if (kcal != null) lines.push(`推定活動消費: ${fmt(kcal)} kcal`);
  return lines.join('\n');
}

function buildMealTotalAnswer(totalKcal = 0) {
  return `今日の食事の合計は、今の記録では ${fmt(round1(totalKcal))} kcal 前後です。`;
}

module.exports = {
  buildEnergySummaryText,
  buildExerciseAnswer,
  buildMealTotalAnswer,
};
