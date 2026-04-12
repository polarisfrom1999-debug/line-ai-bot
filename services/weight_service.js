'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function toHalfWidth(text) {
  return normalizeText(text).replace(/[０-９．％]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function extractNumber(text, pattern) {
  const safe = toHalfWidth(text);
  const match = safe.match(pattern);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function containsQuestionTone(text) {
  return /教えて|知りたい|ですか|ますか|\?$|？$/.test(normalizeText(text));
}

function extractWeightValue(text) {
  const safe = normalizeText(text);
  if (!safe || containsQuestionTone(safe)) return null;
  return extractNumber(safe, /(?:体重\s*)?([0-9]+(?:\.[0-9]+)?)\s*(?:kg|ＫＧ|キロ)\b/i);
}

function extractBodyFatValue(text) {
  const safe = normalizeText(text);
  if (!safe || containsQuestionTone(safe)) return null;
  return extractNumber(safe, /体脂肪率\s*([0-9]+(?:\.[0-9]+)?)\s*(?:%|％|パーセント)?/i);
}

function looksLikeWeightInput(text) {
  const safe = normalizeText(text);
  if (!safe || containsQuestionTone(safe)) return false;
  return Boolean(
    /体重/.test(safe) ||
    /体脂肪率/.test(safe) ||
    /[0-9０-９]+(?:\.[0-9０-９]+)?\s*(?:kg|ＫＧ|キロ)\b/i.test(safe)
  );
}

function buildWeightRecord(text, fallbackPatch = {}) {
  const safe = normalizeText(text);
  const weight = extractWeightValue(safe);
  const bodyFat = extractBodyFatValue(safe);

  const fallbackWeight = fallbackPatch?.weight != null
    ? Number(String(fallbackPatch.weight).replace(/[^\d.]/g, ''))
    : null;
  const fallbackBodyFat = fallbackPatch?.bodyFat != null
    ? Number(String(fallbackPatch.bodyFat).replace(/[^\d.]/g, ''))
    : null;

  const finalWeight = weight != null ? weight : (Number.isFinite(fallbackWeight) ? fallbackWeight : null);
  const finalBodyFat = bodyFat != null ? bodyFat : (Number.isFinite(fallbackBodyFat) ? fallbackBodyFat : null);

  if (finalWeight == null && finalBodyFat == null) return null;

  return {
    type: 'weight',
    summary: safe || '体重記録',
    weight: finalWeight != null ? round1(finalWeight) : null,
    bodyFat: finalBodyFat != null ? round1(finalBodyFat) : null
  };
}

function buildWeightReply(record, options = {}) {
  const lines = [];
  const preferredName = normalizeText(options.preferredName || '');

  if (preferredName) lines.push(`${preferredName}さんの最新を更新しました。`);
  else lines.push('最新の数値として受け取りました。');

  const parts = [];
  if (record?.weight != null) parts.push(`体重 ${round1(record.weight)}kg`);
  if (record?.bodyFat != null) parts.push(`体脂肪率 ${round1(record.bodyFat)}%`);
  if (parts.length) lines.push(parts.join(' / '));

  lines.push('今日の記録にも入れてあります。');
  return lines.join('\n');
}

module.exports = {
  extractWeightValue,
  extractBodyFatValue,
  looksLikeWeightInput,
  buildWeightRecord,
  buildWeightReply
};
