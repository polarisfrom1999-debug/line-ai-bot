'use strict';

function extractWeight(text = '') {
  const raw = String(text || '').trim();
  let m = raw.match(/体重\s*[:：]?\s*(\d{2,3}(?:\.\d+)?)/i);
  if (m) return Number(m[1]);
  m = raw.match(/(\d{2,3}(?:\.\d+)?)\s*(kg|ｋｇ|キロ)/i);
  if (m) return Number(m[1]);
  if (/^\d{2,3}(?:\.\d+)?$/.test(raw)) return Number(raw);
  return null;
}

function extractBodyFat(text = '') {
  const raw = String(text || '').trim();
  let m = raw.match(/体脂肪(?:率)?\s*[:：]?\s*(\d{1,2}(?:\.\d+)?)/);
  if (m) return Number(m[1]);
  if (/体脂肪|%|％/.test(raw)) {
    m = raw.match(/(\d{1,2}(?:\.\d+)?)\s*(%|％)/);
    if (m) return Number(m[1]);
  }
  return null;
}

function isWeightIntent(text = '') {
  const t = String(text || '').trim();
  return /体重|体脂肪|kg|ｋｇ|キロ|%|％/.test(t) || /^\d{2,3}(?:\.\d+)?$/.test(t);
}

function parseWeightLog(text = '') {
  const t = String(text || '').trim();
  const weight = extractWeight(t);
  const bodyFat = extractBodyFat(t);

  if (!Number.isFinite(weight) && !Number.isFinite(bodyFat)) return null;

  return {
    weight_kg: Number.isFinite(weight) && weight >= 20 && weight <= 300 ? weight : null,
    body_fat_pct: Number.isFinite(bodyFat) && bodyFat >= 1 && bodyFat <= 80 ? bodyFat : null,
  };
}

function buildWeightSaveMessage(log = {}) {
  const lines = [];
  if (Number.isFinite(Number(log.weight_kg))) lines.push(`体重: ${Number(log.weight_kg)} kg`);
  if (Number.isFinite(Number(log.body_fat_pct))) lines.push(`体脂肪率: ${Number(log.body_fat_pct)} %`);

  const title = lines.length > 1 ? '体重と体脂肪率を記録しました。' : (lines[0]?.startsWith('体脂肪率') ? '体脂肪率を記録しました。' : '体重を記録しました。');

  return {
    text: [title, ...lines, '小さく続けることが大事です。'].filter(Boolean).join('\n'),
    quickReplies: ['体重グラフ', '予測', '食事を記録', '少し歩いた'],
  };
}

module.exports = {
  isWeightIntent,
  parseWeightLog,
  buildWeightSaveMessage,
};
