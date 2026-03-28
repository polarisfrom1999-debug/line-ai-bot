services/record_normalizer_service.js
'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
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
  normalizeCandidate
};
