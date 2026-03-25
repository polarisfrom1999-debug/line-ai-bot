'use strict';

const { fmt } = require('../utils/formatters');

function extractBodyFat(text) {
  const direct = String(text || '').match(/体脂肪(?:率)?\s*[:：]?\s*(\d{1,2}(?:\.\d+)?)/);
  if (direct) return Number(direct[1]);
  const percentOnly = String(text || '').match(/^(\d{1,2}(?:\.\d+)?)\s*[%％]$/);
  return percentOnly ? Number(percentOnly[1]) : null;
}

function isWeightIntent(text) {
  const t = String(text || '').trim();
  return /体重|kg|キロ/i.test(t) || /^\d{2,3}(?:\.\d+)?$/.test(t);
}

function parseWeightLog(text) {
  const t = String(text || '').trim();
  const weightDirect = t.match(/体重\s*[:：]?\s*(\d{2,3}(?:\.\d+)?)/i);
  const weightWithUnit = t.match(/(\d{2,3}(?:\.\d+)?)\s*(kg|ｋｇ|キロ)/i);
  const bodyFat = extractBodyFat(t);

  let weight = null;
  if (weightDirect) weight = Number(weightDirect[1]);
  else if (weightWithUnit) weight = Number(weightWithUnit[1]);
  else if (/^\d{2,3}(?:\.\d+)?$/.test(t)) weight = Number(t);

  return {
    weight_kg: Number.isFinite(weight) && weight >= 20 && weight <= 300 ? weight : null,
    body_fat_pct: Number.isFinite(bodyFat) && bodyFat >= 1 && bodyFat <= 80 ? bodyFat : null,
  };
}

function buildWeightSaveMessage(log) {
  const lines = [
    log.weight_kg != null ? `体重 ${fmt(log.weight_kg)}kg を記録しました。` : null,
    log.body_fat_pct != null ? `体脂肪率 ${fmt(log.body_fat_pct)}% も受け取りました。` : null,
    'また変化があればそのまま送ってくださいね。',
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    quickReplies: ['今日のまとめ', '体重グラフ', '予測', '食事を記録'],
  };
}

module.exports = {
  isWeightIntent,
  parseWeightLog,
  buildWeightSaveMessage,
};
