services/record_candidate_service.js
'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function detectMealCandidate(text) {
  const safe = normalizeText(text);
  if (!/朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|食べた|飲んだ|ラーメン|カレー|寿司|卵|味噌汁|サラダ|ごはん|パン|ヨーグルト|バナナ/.test(safe)) {
    return null;
  }

  return {
    type: 'meal',
    summary: safe
  };
}

function detectExerciseCandidate(text) {
  const safe = normalizeText(text);
  if (/スクワット/.test(safe)) {
    return {
      type: 'exercise',
      name: 'スクワット',
      summary: safe
    };
  }

  if (/ジョギング|ランニング|走った|走りました/.test(safe)) {
    return {
      type: 'exercise',
      name: 'ジョギング',
      summary: safe
    };
  }

  if (/歩いた|ウォーキング/.test(safe)) {
    return {
      type: 'exercise',
      name: 'ウォーキング',
      summary: safe
    };
  }

  return null;
}

function detectWeightCandidate(text) {
  const safe = normalizeText(text);

  if (/体脂肪率/.test(safe)) {
    return {
      type: 'weight',
      summary: safe
    };
  }

  if (/体重/.test(safe) || /^[0-9０-９]+(\.[0-9０-９]+)?\s*(kg|ＫＧ|キロ)/i.test(safe)) {
    return {
      type: 'weight',
      summary: safe
    };
  }

  return null;
}

function detectLabCandidate(text) {
  const safe = normalizeText(text);
  if (!/LDL|HDL|中性脂肪|HbA1c|AST|ALT|γ-GTP|LDH|血液検査/.test(safe)) {
    return null;
  }

  return {
    type: 'lab',
    summary: safe
  };
}

function extractCandidatesFromText(text) {
  const safe = normalizeText(text);
  if (!safe) return [];

  const candidates = [];

  const meal = detectMealCandidate(safe);
  if (meal) candidates.push(meal);

  const exercise = detectExerciseCandidate(safe);
  if (exercise) candidates.push(exercise);

  const weight = detectWeightCandidate(safe);
  if (weight) candidates.push(weight);

  const lab = detectLabCandidate(safe);
  if (lab) candidates.push(lab);

  return candidates;
}

function buildMealCandidateFromAnalysis(parsedMeal, rawText) {
  return {
    type: 'meal',
    name: Array.isArray(parsedMeal?.items) && parsedMeal.items.length ? parsedMeal.items.join('、') : normalizeText(rawText) || '食事',
    summary: normalizeText(rawText) || '食事',
    estimatedNutrition: {
      kcal: round1(parsedMeal?.estimatedNutrition?.kcal || 0),
      protein: round1(parsedMeal?.estimatedNutrition?.protein || 0),
      fat: round1(parsedMeal?.estimatedNutrition?.fat || 0),
      carbs: round1(parsedMeal?.estimatedNutrition?.carbs || 0)
    },
    amountRatio: Number(parsedMeal?.amountRatio || 1),
    amountNote: normalizeText(parsedMeal?.amountNote || '')
  };
}

function buildMealCandidateFromImageAnalysis(parsedMeal) {
  return {
    type: 'meal',
    name: Array.isArray(parsedMeal?.items) && parsedMeal.items.length ? parsedMeal.items.join('、') : '食事写真',
    summary: Array.isArray(parsedMeal?.items) && parsedMeal.items.length ? parsedMeal.items.join('、') : '食事写真',
    estimatedNutrition: {
      kcal: round1(parsedMeal?.estimatedNutrition?.kcal || 0),
      protein: round1(parsedMeal?.estimatedNutrition?.protein || 0),
      fat: round1(parsedMeal?.estimatedNutrition?.fat || 0),
      carbs: round1(parsedMeal?.estimatedNutrition?.carbs || 0)
    },
    amountNote: normalizeText(parsedMeal?.amountNote || '標準')
  };
}

function buildLabCandidateFromImageAnalysis(parsedLab) {
  return {
    type: 'lab',
    summary: '血液検査画像',
    examDate: normalizeText(parsedLab?.examDate || ''),
    items: Array.isArray(parsedLab?.items) ? parsedLab.items : []
  };
}

module.exports = {
  extractCandidatesFromText,
  buildMealCandidateFromAnalysis,
  buildMealCandidateFromImageAnalysis,
  buildLabCandidateFromImageAnalysis
};
