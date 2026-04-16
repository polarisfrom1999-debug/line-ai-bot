'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function round0(value) {
  return Math.round(Number(value || 0));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeMealLabel(value) {
  const safe = normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）・/／]/g, '');
  if (!safe) return '';
  if (/ラーメン|らーめん/.test(safe)) return 'ラーメン';
  if (/カレー/.test(safe)) return 'カレー';
  if (/パスタ|スパゲティ/.test(safe)) return 'パスタ';
  if (/パン|トースト|サンド/.test(safe)) return 'パン';
  if (/ご飯|ごはん|丼|おにぎり/.test(safe)) return 'ご飯系';
  if (/サラダ/.test(safe)) return 'サラダ';
  if (/魚|鮭|さば|鯖/.test(safe)) return '魚料理';
  if (/肉|鶏|豚|牛|唐揚げ/.test(safe)) return '肉料理';
  return normalizeText(value);
}

function average(values = []) {
  const list = values.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
  if (!list.length) return 0;
  return list.reduce((sum, v) => sum + v, 0) / list.length;
}

function estimatePersonalRatio({ mealLabel = '', recentMeals = [] } = {}) {
  const normalizedLabel = normalizeMealLabel(mealLabel);
  const rows = Array.isArray(recentMeals) ? recentMeals : [];
  const allKcals = rows.map((row) => toNumber(row.kcal || row.estimated_kcal || row.estimatedNutrition?.kcal || 0)).filter((v) => v > 0);
  const sameLabelKcals = rows
    .filter((row) => normalizeMealLabel(row.meal_label || row.mealLabel || row.summary || row.name || '') === normalizedLabel)
    .map((row) => toNumber(row.kcal || row.estimated_kcal || row.estimatedNutrition?.kcal || 0))
    .filter((v) => v > 0);

  const baseline = average(allKcals);
  const labelAverage = average(sameLabelKcals);
  if (!baseline || !labelAverage) {
    return {
      ratio: 1,
      confidence: 0.35,
      basis: sameLabelKcals.length ? 'label_only' : 'insufficient_history'
    };
  }

  const rawRatio = labelAverage / baseline;
  const ratio = clamp(rawRatio, 0.8, 1.2);
  const confidence = clamp(0.45 + Math.min(sameLabelKcals.length, 12) * 0.03, 0.45, 0.88);
  return {
    ratio,
    confidence,
    basis: 'label_vs_person_average'
  };
}

function applyPersonalization({ mealLabel = '', nutrition = {}, recentMeals = [], textProvided = false } = {}) {
  const ratioInfo = estimatePersonalRatio({ mealLabel, recentMeals });
  const ratio = clamp(ratioInfo.ratio || 1, 0.8, 1.2);

  const adjusted = {
    kcal: round0(toNumber(nutrition.kcal, 0) * ratio),
    protein: round1(toNumber(nutrition.protein, 0) * ratio),
    fat: round1(toNumber(nutrition.fat, 0) * ratio),
    carbs: round1(toNumber(nutrition.carbs, 0) * ratio)
  };

  let confidence = clamp(0.62 + (textProvided ? 0.12 : 0) + (ratioInfo.confidence - 0.45) * 0.2, 0.55, 0.9);
  if (ratioInfo.basis !== 'insufficient_history') confidence = clamp(confidence + 0.05, 0, 0.95);

  return {
    adjusted,
    appliedRatio: ratio,
    personalizationConfidence: ratioInfo.confidence,
    confidence,
    basis: ratioInfo.basis
  };
}

function analyzeMealPatterns(recentMeals = []) {
  const slots = { breakfast: [], lunch: [], dinner: [], unknown: [] };
  for (const row of Array.isArray(recentMeals) ? recentMeals : []) {
    const kcal = toNumber(row.kcal || row.estimated_kcal || row.estimatedNutrition?.kcal || 0);
    const fat = toNumber(row.fat || row.fat_g || row.estimatedNutrition?.fat || 0);
    const rawSlot = normalizeText(row.meal_time_hint || row.mealType || row.slot || '');
    const slot = rawSlot === 'breakfast' || rawSlot === 'lunch' || rawSlot === 'dinner' ? rawSlot : 'unknown';
    slots[slot].push({ kcal, fat });
  }

  const avgFat = (list) => average(list.map((r) => r.fat));
  const hints = [];
  if (avgFat(slots.dinner) >= 20 && slots.dinner.length >= 3) hints.push('夜に脂質が多め');
  if (average(slots.breakfast.map((r) => r.kcal)) <= 250 && slots.breakfast.length >= 3) hints.push('朝の摂取量が少なめ');
  if (average(slots.lunch.map((r) => r.kcal)) >= 700 && slots.lunch.length >= 3) hints.push('昼にボリュームが寄りやすい');
  return { hints };
}

function detectCalorieWeightMismatch({ recentMeals = [], recentWeights = [] } = {}) {
  const mealRows = Array.isArray(recentMeals) ? recentMeals : [];
  const weightRows = Array.isArray(recentWeights) ? recentWeights : [];
  if (mealRows.length < 5 || weightRows.length < 3) return { level: 'unknown', note: '' };

  const avgKcal = average(mealRows.map((row) => row.kcal || row.estimated_kcal || row.estimatedNutrition?.kcal || 0));
  const sortedWeights = weightRows
    .map((row) => ({ date: normalizeText(row.date || row.logged_at || ''), weight: toNumber(row.weight || row.weight_kg || row.value || 0) }))
    .filter((row) => row.weight > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (sortedWeights.length < 3) return { level: 'unknown', note: '' };

  const first = sortedWeights[0].weight;
  const last = sortedWeights[sortedWeights.length - 1].weight;
  const delta = round1(last - first);

  if (avgKcal <= 1600 && delta >= 0.8) {
    return { level: 'possible_under_logging', note: '記録より摂取が多い可能性' };
  }
  if (avgKcal >= 2300 && delta <= -0.8) {
    return { level: 'possible_over_logging', note: '記録より摂取が少ない可能性' };
  }
  return { level: 'balanced', note: '' };
}

function buildSingleFeedback({ nutrition = {}, patterns = {}, mismatch = {} } = {}) {
  if (mismatch?.level === 'possible_under_logging') return '記録漏れが少しありそうなので、間食だけ一言足せると精度が上がります。';
  if (patterns?.hints?.includes('夜に脂質が多め')) return '夜の脂質が少し多めなので、次は汁物か野菜を1つ足すと整えやすいです。';
  if (toNumber(nutrition.protein, 0) >= 25) return 'たんぱく質がしっかり取れていて良い流れです。';
  if (toNumber(nutrition.kcal, 0) > 0) return '記録を続けられているのが一番の強みです。';
  return '';
}

module.exports = {
  normalizeMealLabel,
  estimatePersonalRatio,
  applyPersonalization,
  analyzeMealPatterns,
  detectCalorieWeightMismatch,
  buildSingleFeedback
};
