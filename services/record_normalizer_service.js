'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function safeText(value, maxLen = 400) {
  const safe = normalizeText(value);
  return safe.length > maxLen ? safe.slice(0, maxLen) : safe;
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function parseMealAmountRatio(text = '') {
  const safe = normalizeText(text);
  if (!safe) return { ratio: 1, note: '' };

  if (/半分|半分くらい|half/i.test(safe)) return { ratio: 0.5, note: '半分' };
  if (/少なめ|少し|7割|0\.7|0,7/.test(safe)) return { ratio: 0.7, note: '少なめ' };
  if (/8割|0\.8|0,8/.test(safe)) return { ratio: 0.8, note: '8割' };
  if (/多め|大盛り|1\.2|1,2/.test(safe)) return { ratio: 1.2, note: '多め' };
  if (/1\.5|1,5|1\.5倍|1,5倍/.test(safe)) return { ratio: 1.5, note: '1.5倍' };
  if (/2倍|2\.0|2,0/.test(safe)) return { ratio: 2.0, note: '2倍' };
  if (/全部|完食|通常/.test(safe)) return { ratio: 1, note: '通常量' };

  const m = safe.match(/([0-9]+(?:\.[0-9]+)?)\s*倍/);
  if (m) {
    const ratio = Number(m[1]);
    if (Number.isFinite(ratio) && ratio > 0) return { ratio, note: `${ratio}倍` };
  }
  return { ratio: 1, note: '' };
}

function applyMealAmountRatio(candidate = {}, amountText = '') {
  const ratioInfo = parseMealAmountRatio(amountText);
  const ratio = Math.max(0.2, Math.min(2.0, Number(ratioInfo.ratio || 1)));
  if (ratio === 1) return normalizeMeal(candidate);

  const normalized = normalizeMeal(candidate);
  const recalc = {
    kcal: round1((normalized.estimatedNutrition?.kcal || 0) * ratio),
    protein: round1((normalized.estimatedNutrition?.protein || 0) * ratio),
    fat: round1((normalized.estimatedNutrition?.fat || 0) * ratio),
    carbs: round1((normalized.estimatedNutrition?.carbs || 0) * ratio)
  };
  return {
    ...normalized,
    estimatedNutrition: recalc,
    kcal: recalc.kcal,
    protein: recalc.protein,
    fat: recalc.fat,
    carbs: recalc.carbs,
    amountRatio: ratio,
    amountNote: ratioInfo.note || normalizeText(amountText || normalized.amountNote || '')
  };
}

function normalizeRecordCandidate(candidate = {}) {
  if (!candidate || typeof candidate !== 'object') return {};
  const safe = {
    ...candidate,
    type: normalizeText(candidate.type || ''),
    source: normalizeText(candidate.source || ''),
    confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : 0.6,
    needs_confirmation: candidate.needs_confirmation !== false,
    parsed_payload: candidate.parsed_payload && typeof candidate.parsed_payload === 'object'
      ? { ...candidate.parsed_payload }
      : {},
    meta: candidate.meta && typeof candidate.meta === 'object' ? { ...candidate.meta } : {}
  };
  return safe;
}

function normalizeMeal(candidate) {
  return {
    type: 'meal',
    name: normalizeText(candidate?.name || candidate?.summary || '食事'),
    summary: normalizeText(candidate?.summary || candidate?.name || '食事'),
    estimatedNutrition: {
      kcal: round1(candidate?.estimatedNutrition?.kcal || candidate?.kcal || 0),
      protein: round1(candidate?.estimatedNutrition?.protein || candidate?.protein || 0),
      fat: round1(candidate?.estimatedNutrition?.fat || candidate?.fat || 0),
      carbs: round1(candidate?.estimatedNutrition?.carbs || candidate?.carbs || 0)
    },
    kcal: round1(candidate?.kcal || candidate?.estimatedNutrition?.kcal || 0),
    protein: round1(candidate?.protein || candidate?.estimatedNutrition?.protein || 0),
    fat: round1(candidate?.fat || candidate?.estimatedNutrition?.fat || 0),
    carbs: round1(candidate?.carbs || candidate?.estimatedNutrition?.carbs || 0),
    amountRatio: Number(candidate?.amountRatio || 1),
    amountNote: normalizeText(candidate?.amountNote || '')
  };
}

function normalizeExercise(candidate) {
  return {
    type: 'exercise',
    name: normalizeText(candidate?.name || '運動'),
    summary: normalizeText(candidate?.summary || candidate?.name || '運動')
  };
}

function normalizeWeight(candidate) {
  return {
    type: 'weight',
    summary: normalizeText(candidate?.summary || '体重記録')
  };
}

function normalizeLabItem(item) {
  return {
    itemName: normalizeText(item?.itemName || item?.name || ''),
    value: normalizeText(item?.value || ''),
    unit: normalizeText(item?.unit || '')
  };
}

function normalizeLab(candidate) {
  return {
    type: 'lab',
    summary: normalizeText(candidate?.summary || '血液検査'),
    examDate: normalizeText(candidate?.examDate || ''),
    items: (Array.isArray(candidate?.items) ? candidate.items : [])
      .map(normalizeLabItem)
      .filter((item) => item.itemName && item.value)
  };
}

async function normalizeCandidate(candidate) {
  if (!candidate || !candidate.type) return null;

  if (candidate.type === 'meal') {
    return normalizeMeal(candidate);
  }

  if (candidate.type === 'exercise') {
    return normalizeExercise(candidate);
  }

  if (candidate.type === 'weight') {
    return normalizeWeight(candidate);
  }

  if (candidate.type === 'lab') {
    return normalizeLab(candidate);
  }

  return null;
}

module.exports = {
  safeText,
  toNumberOrNull,
  normalizeRecordCandidate,
  parseMealAmountRatio,
  applyMealAmountRatio,
  normalizeCandidate
};
