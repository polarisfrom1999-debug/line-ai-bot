'use strict';

function extractWeight(text = '') {
  const raw = String(text || '').trim();
  const explicit = raw.match(/体重\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:kg|ｋｇ|キロ)?/i);
  if (explicit) return Number(explicit[1]);
  const only = raw.match(/^(\d+(?:\.\d+)?)\s*(?:kg|ｋｇ|キロ)$/i);
  if (only) return Number(only[1]);
  const plain = raw.match(/^(\d{2,3}(?:\.\d+)?)$/);
  if (plain) return Number(plain[1]);
  return null;
}

function extractBodyFat(text = '') {
  const raw = String(text || '').trim();
  const explicit = raw.match(/体脂肪(?:率)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:%|％)?/i);
  if (explicit) return Number(explicit[1]);
  const only = raw.match(/^(\d+(?:\.\d+)?)\s*(?:%|％)$/);
  if (only) return Number(only[1]);
  return null;
}

function isWeightIntent(text = '') {
  return extractWeight(text) != null;
}

function parseWeightLog(text = '') {
  const weight_kg = extractWeight(text);
  const body_fat_pct = extractBodyFat(text);
  if (weight_kg == null && body_fat_pct == null) return null;
  return {
    weight_kg: Number.isFinite(weight_kg) ? weight_kg : null,
    body_fat_pct: Number.isFinite(body_fat_pct) ? body_fat_pct : null,
  };
}

function buildWeightSaveMessage(log = {}) {
  const lines = [];
  if (log.weight_kg != null) lines.push(`体重は ${log.weight_kg}kg として記録しました。`);
  if (log.body_fat_pct != null) lines.push(`体脂肪率は ${log.body_fat_pct}% として見ています。`);
  if (!lines.length) lines.push('数字は受け取れました。');
  lines.push('流れを見るなら「体重グラフ」、見通しなら「予測」でも大丈夫です。');
  return {
    text: lines.join('\n'),
    quickReplies: ['体重グラフ', '予測'],
  };
}

module.exports = {
  isWeightIntent,
  parseWeightLog,
  buildWeightSaveMessage,
};
