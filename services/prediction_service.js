'use strict';

const { fmt } = require('../utils/formatters');

function buildPredictionText({ estimatedTdee = 0, intakeKcal = 0, activityKcal = 0, currentWeightKg = null } = {}) {
  const net = Number(intakeKcal || 0) - Number(estimatedTdee || 0) - Number(activityKcal || 0);
  const weekly = Math.round((net * 7 / 7200) * 10) / 10;
  const lines = [
    '今の記録から、ざっくりした見通しを出しますね。',
    `摂取: ${fmt(intakeKcal)} kcal`,
    `活動消費: ${fmt(activityKcal)} kcal`,
    `推定総消費目安: ${fmt(estimatedTdee)} kcal`,
    `ざっくり収支: ${fmt(net)} kcal/日`,
    `この流れが1週間続いた場合の目安: ${weekly > 0 ? '+' : ''}${fmt(weekly)} kg`,
    currentWeightKg != null ? `今の体重 ${fmt(currentWeightKg)} kg からみると、1週間後の目安は ${fmt(Number(currentWeightKg) + Number(weekly))} kg 前後です。` : null,
  ].filter(Boolean);
  return { text: lines.join('\n'), quickReplies: ['体重グラフ'] };
}

function isPredictionIntent(text = '') {
  return /(予測|体重予測|見通し|このまま続けたら|このままだとどうなる)/.test(String(text || ''));
}

module.exports = { buildPredictionText, isPredictionIntent };
