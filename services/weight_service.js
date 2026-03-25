'use strict';

function extractNumber(text = '') {
  const m = String(text || '').match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function extractWeight(text = '') {
  const t = String(text || '').trim();
  let m = t.match(/体重\s*[:：]?\s*(-?\d+(?:\.\d+)?)/i);
  if (m) return Number(m[1]);
  m = t.match(/(-?\d+(?:\.\d+)?)\s*(kg|ｋｇ|キロ)/i);
  if (m) return Number(m[1]);
  if (/^\d{2,3}(?:\.\d+)?$/.test(t)) return Number(t);
  return null;
}

function extractBodyFat(text = '') {
  const t = String(text || '').trim();
  let m = t.match(/体脂肪(?:率)?\s*[:：]?\s*(-?\d+(?:\.\d+)?)/i);
  if (m) return Number(m[1]);
  if (/体脂肪/.test(t) || /%|％|パー/.test(t)) {
    m = t.match(/(-?\d+(?:\.\d+)?)/);
    if (m) return Number(m[1]);
  }
  return null;
}

function parseBodyMetrics(text = '') {
  const weight = extractWeight(text);
  const bodyFat = extractBodyFat(text);
  return {
    weight_kg: Number.isFinite(weight) && weight >= 20 && weight <= 300 ? Math.round(weight * 10) / 10 : null,
    body_fat_pct: Number.isFinite(bodyFat) && bodyFat >= 1 && bodyFat <= 80 ? Math.round(bodyFat * 10) / 10 : null,
  };
}

function isWeightIntent(text = '') {
  return parseBodyMetrics(text).weight_kg != null;
}

function isBodyFatIntent(text = '') {
  return parseBodyMetrics(text).body_fat_pct != null;
}

function buildWeightSaveMessage(log = {}) {
  const lines = [];
  if (log.weight_kg != null) lines.push(`体重は ${log.weight_kg}kg として記録しました。`);
  if (log.body_fat_pct != null) lines.push(`体脂肪率は ${log.body_fat_pct}% として記録しました。`);
  if (!lines.length) lines.push('数字を受け取りました。');
  lines.push('流れを見るなら「体重グラフ」、見通しなら「予測」でも大丈夫です。');
  return {
    text: lines.join('\n'),
    quickReplies: ['体重グラフ', '予測'],
  };
}

module.exports = {
  parseBodyMetrics,
  isWeightIntent,
  isBodyFatIntent,
  buildWeightSaveMessage,
};
