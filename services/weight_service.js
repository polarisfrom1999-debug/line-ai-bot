'use strict';

function extractNumber(text) {
  const m = String(text || '').match(/(\d{1,3}(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function extractWeight(text = '') {
  const raw = String(text || '');
  const explicit = raw.match(/体重\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)/);
  if (explicit) return Number(explicit[1]);
  const kg = raw.match(/(\d{1,3}(?:\.\d+)?)\s*(kg|ｋｇ|キロ)/i);
  if (kg) return Number(kg[1]);
  return null;
}

function extractBodyFat(text = '') {
  const raw = String(text || '');
  const explicit = raw.match(/体脂肪(?:率)?\s*[:：]?\s*(\d{1,2}(?:\.\d+)?)/);
  if (explicit) return Number(explicit[1]);
  const pct = raw.match(/(\d{1,2}(?:\.\d+)?)\s*(%|％)/);
  if (pct && /体脂肪/.test(raw)) return Number(pct[1]);
  return null;
}

function isWeightIntent(text = '') {
  const t = String(text || '').trim();
  return /体重/.test(t) || /(kg|ｋｇ|キロ)/i.test(t) || /^\d{2,3}(?:\.\d+)?$/.test(t);
}

function isBodyFatIntent(text = '') {
  const t = String(text || '').trim();
  return /体脂肪/.test(t) || /^\d{1,2}(?:\.\d+)?\s*(%|％)$/.test(t);
}

function parseWeightLog(text = '') {
  const t = String(text || '').trim();
  const weight = extractWeight(t);
  const bodyFat = extractBodyFat(t);

  if (weight == null && bodyFat == null) return null;

  return {
    weight_kg: Number.isFinite(weight) && weight >= 20 && weight <= 300 ? weight : null,
    body_fat_pct: Number.isFinite(bodyFat) && bodyFat >= 1 && bodyFat <= 80 ? bodyFat : null,
  };
}

function buildWeightSaveMessage(log = {}) {
  const lines = [
    '体重を記録しました。',
    log.weight_kg != null ? `体重: ${log.weight_kg} kg` : null,
    log.body_fat_pct != null ? `体脂肪率: ${log.body_fat_pct} %` : null,
    '小さく続けることが大事です。',
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    quickReplies: ['体重グラフ', '予測', '食事の写真です', '相談したい'],
  };
}

function buildBodyFatSaveMessage(log = {}) {
  const lines = [
    '体脂肪率を受け取りました。',
    log.body_fat_pct != null ? `体脂肪率: ${log.body_fat_pct} %` : null,
    '体重も一緒にあると流れが見やすくなります。',
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    quickReplies: ['体重 62.4kg', '体重グラフ', '予測'],
  };
}

module.exports = {
  extractNumber,
  extractWeight,
  extractBodyFat,
  isWeightIntent,
  isBodyFatIntent,
  parseWeightLog,
  buildWeightSaveMessage,
  buildBodyFatSaveMessage,
};
