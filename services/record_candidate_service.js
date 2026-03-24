'use strict';

/**
 * services/record_candidate_service.js
 */

const {
  safeText,
  toNumberOrNull,
  normalizeRecordCandidate,
} = require('./record_normalizer_service');

function normalizeLoose(text = '') {
  return safeText(text)
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text = '', patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function looksLikeConsultation(text = '') {
  const t = normalizeLoose(text);
  if (!t) return false;
  if (/[?？]/.test(String(text || ''))) return true;
  return includesAny(t, [
    /どう思う/,
    /大丈夫かな/,
    /いいかな/,
    /してもいい/,
    /したらだめ/,
    /相談/,
    /つらい/,
    /痛い/,
    /不安/,
    /悩/,
    /わからない/,
    /違和感/,
    /気になる/,
    /平気/,
  ]);
}

function extractMealCandidate(text = '') {
  const t = safeText(text);
  const normalized = normalizeLoose(text);

  if (!includesAny(normalized, [
    /食べ/,
    /食事/,
    /朝食/,
    /昼食/,
    /夕食/,
    /間食/,
    /飲んだ/,
    /飲みました/,
    /ラーメン/,
    /ご飯/,
    /パン/,
    /おにぎり/,
    /外食/,
  ])) {
    return null;
  }

  const amountMatch = t.match(/(\d+(?:\.\d+)?)\s*kcal/i);
  const estimatedKcal = amountMatch ? toNumberOrNull(amountMatch[1]) : null;

  return normalizeRecordCandidate({
    type: 'meal',
    confidence: 0.68,
    needs_confirmation: true,
    source: 'text',
    parsed_payload: {
      meal_label: t,
      raw_text: t,
      estimated_kcal: estimatedKcal,
    },
  });
}

function extractExerciseCandidate(text = '') {
  const t = safeText(text);
  const normalized = normalizeLoose(text);

  if (looksLikeConsultation(text)) return null;

  if (!includesAny(normalized, [
    /歩い/,
    /散歩/,
    /走っ/,
    /ジョギング/,
    /筋トレ/,
    /ストレッチ/,
    /運動/,
    /スクワット/,
    /泳い/,
    /自転車/,
  ])) {
    return null;
  }

  const durationMatch = t.match(/(\d+(?:\.\d+)?)\s*(分|ぷん|minutes|min)/i);
  const durationMinutes = durationMatch ? toNumberOrNull(durationMatch[1]) : null;

  return normalizeRecordCandidate({
    type: 'exercise',
    confidence: 0.7,
    needs_confirmation: true,
    source: 'text',
    parsed_payload: {
      exercise_name: t,
      duration_minutes: durationMinutes,
    },
  });
}

function extractWeightCandidate(text = '') {
  const t = safeText(text);
  const normalized = normalizeLoose(text);

  if (!includesAny(normalized, [/体重/, /kg/, /キロ/])) return null;

  const match = t.match(/(\d+(?:\.\d+)?)\s*(kg|ｋｇ|キロ)/i);
  const weight = match ? toNumberOrNull(match[1]) : null;
  if (weight === null) return null;

  return normalizeRecordCandidate({
    type: 'weight',
    confidence: 0.85,
    needs_confirmation: true,
    source: 'text',
    parsed_payload: {
      weight_kg: weight,
    },
  });
}

function extractBodyFatCandidate(text = '') {
  const t = safeText(text);
  const normalized = normalizeLoose(text);

  if (!includesAny(normalized, [/体脂肪/, /%/])) return null;

  const match = t.match(/(\d+(?:\.\d+)?)\s*%/);
  const bodyFatPercent = match ? toNumberOrNull(match[1]) : null;
  if (bodyFatPercent === null) return null;

  return normalizeRecordCandidate({
    type: 'body_fat',
    confidence: 0.82,
    needs_confirmation: true,
    source: 'text',
    parsed_payload: {
      body_fat_percent: bodyFatPercent,
    },
  });
}

function extractBloodTestCandidate(text = '') {
  const normalized = normalizeLoose(text);
  const t = safeText(text);

  if (!includesAny(normalized, [
    /血液検査/,
    /hba1c/i,
    /血糖/,
    /中性脂肪/,
    /コレステロール/,
    /ast/,
    /alt/,
    /γ-?gtp/i,
    /ldl/,
    /hdl/,
  ])) {
    return null;
  }

  return normalizeRecordCandidate({
    type: 'blood_test',
    confidence: 0.9,
    needs_confirmation: true,
    source: 'text',
    parsed_payload: {
      raw_text: t,
    },
  });
}

function extractRecordCandidatesFromText(text = '') {
  const candidates = [
    extractBloodTestCandidate(text),
    extractWeightCandidate(text),
    extractBodyFatCandidate(text),
    extractExerciseCandidate(text),
    extractMealCandidate(text),
  ].filter(Boolean);

  return candidates.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
}

function getTopRecordCandidate(text = '') {
  const list = extractRecordCandidatesFromText(text);
  return list[0] || null;
}

module.exports = {
  normalizeLoose,
  looksLikeConsultation,
  extractMealCandidate,
  extractExerciseCandidate,
  extractWeightCandidate,
  extractBodyFatCandidate,
  extractBloodTestCandidate,
  extractRecordCandidatesFromText,
  getTopRecordCandidate,
};
