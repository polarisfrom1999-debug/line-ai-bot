'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');

const FOOD_LIBRARY = [
  { keywords: ['ラーメン', '塩ラーメン', '味噌ラーメン', '醤油ラーメン'], label: 'ラーメン', kcal: 520 },
  { keywords: ['フォー'], label: 'フォー', kcal: 430 },
  { keywords: ['カレー'], label: 'カレー', kcal: 620 },
  { keywords: ['ごはん', '白米', 'おにぎり'], label: 'ごはんもの', kcal: 230 },
  { keywords: ['パン', 'トースト'], label: 'パン', kcal: 180 },
  { keywords: ['パスタ', 'スパゲティ'], label: 'パスタ', kcal: 520 },
  { keywords: ['うどん'], label: 'うどん', kcal: 320 },
  { keywords: ['そば'], label: 'そば', kcal: 300 },
  { keywords: ['寿司', 'すし'], label: '寿司', kcal: 420 },
  { keywords: ['サラダ'], label: 'サラダ', kcal: 90 },
  { keywords: ['味噌汁', 'みそ汁', 'スープ'], label: '汁物', kcal: 50 },
  { keywords: ['卵', 'たまご', '目玉焼き'], label: '卵料理', kcal: 120 },
  { keywords: ['鶏肉', '鶏', 'サラダチキン'], label: '鶏肉料理', kcal: 220 },
  { keywords: ['牛肉'], label: '牛肉料理', kcal: 260 },
  { keywords: ['豚肉'], label: '豚肉料理', kcal: 260 },
  { keywords: ['豆腐'], label: '豆腐料理', kcal: 90 },
  { keywords: ['納豆'], label: '納豆', kcal: 90 },
  { keywords: ['いちご'], label: 'いちご', kcal: 35 },
  { keywords: ['バナナ'], label: 'バナナ', kcal: 86 },
  { keywords: ['ヨーグルト'], label: 'ヨーグルト', kcal: 90 },
  { keywords: ['ソーセージ'], label: 'ソーセージ', kcal: 140 },
  { keywords: ['ブロッコリー'], label: 'ブロッコリー', kcal: 30 },
  { keywords: ['パプリカ'], label: 'パプリカ', kcal: 25 },
  { keywords: ['弁当'], label: 'お弁当', kcal: 650 },
];

const MEAL_WORDS = FOOD_LIBRARY.flatMap((item) => item.keywords);
const LAB_BLOCK_WORDS = [/検査結果/, /HbA1c/i, /LDL/i, /HDL/i, /TG/i, /中性脂肪/, /血液検査/];

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 10) / 10;
}

function round0(n) {
  return Math.round(Number(n || 0));
}

function detectMealType(text) {
  const safe = normalizeText(text);
  if (/朝|朝ごはん|朝食/.test(safe)) return 'breakfast';
  if (/昼|昼ごはん|昼食|ランチ/.test(safe)) return 'lunch';
  if (/夜|夕食|晩ごはん|ディナー/.test(safe)) return 'dinner';
  if (/間食|おやつ/.test(safe)) return 'snack';
  return 'unknown';
}

function sanitizeGeminiText(text) {
  return String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
}

function extractJsonObject(text) {
  const safe = sanitizeGeminiText(text);
  const start = safe.indexOf('{');
  const end = safe.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(safe.slice(start, end + 1));
  } catch (_error) {
    return null;
  }
}

function pickMatchedFoods(text) {
  const safe = normalizeText(text);
  const matched = [];
  for (const food of FOOD_LIBRARY) {
    if (food.keywords.some((kw) => safe.includes(kw))) matched.push(food);
  }
  return matched;
}

function buildSimpleNutritionFromFoods(foods) {
  if (!foods.length) return { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  const kcal = foods.slice(0, 3).reduce((sum, item) => sum + Number(item.kcal || 0), 0);
  return { kcal: round0(kcal), protein: 0, fat: 0, carbs: 0 };
}

function buildSummaryLabel(foods, fallback = '食事') {
  if (!foods.length) return fallback;
  const uniqueLabels = [...new Set(foods.map((item) => item.label))];
  if (uniqueLabels.length === 1) return uniqueLabels[0];
  if (uniqueLabels.length === 2) return `${uniqueLabels[0]}と${uniqueLabels[1]}`;
  return `${uniqueLabels[0]}中心の食事`;
}

function buildKcalRange(baseKcal) {
  const kcal = Math.max(0, round0(baseKcal));
  if (!kcal) return { low: 0, high: 0 };
  return {
    low: Math.max(0, round0(kcal * 0.85)),
    high: round0(kcal * 1.15),
  };
}

function parseMealText(text) {
  const safe = normalizeText(text);
  const foods = pickMatchedFoods(safe);
  const nutrition = buildSimpleNutritionFromFoods(foods);
  const kcalRange = buildKcalRange(nutrition.kcal);

  return {
    source: 'text',
    isMealText: foods.length > 0,
    isMealImage: false,
    mealType: detectMealType(safe),
    items: foods.map((item) => item.label),
    summaryLabel: buildSummaryLabel(foods, safe || '食事'),
    amountNote: '',
    amountRatio: 1,
    estimatedNutrition: nutrition,
    kcalRange,
    comment: foods.length ? 'ざっくりした食事として見ています。' : '',
    confidence: foods.length ? 0.72 : 0.15,
    recordReady: foods.length > 0,
  };
}

function buildHeuristicImageMeal(rawText) {
  const safe = sanitizeGeminiText(rawText);
  if (LAB_BLOCK_WORDS.some((pattern) => pattern.test(safe))) {
    return {
      source: 'image',
      isMealImage: false,
      imageKind: 'unknown',
      mealType: 'unknown',
      items: [],
      summaryLabel: '',
      estimatedNutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
      kcalRange: { low: 0, high: 0 },
      comment: '',
      ocrText: safe,
      confidence: 0.1,
      recordReady: false,
    };
  }

  const foods = pickMatchedFoods(safe);
  const nutrition = buildSimpleNutritionFromFoods(foods);
  const kcalRange = buildKcalRange(nutrition.kcal || (foods.length ? 380 : 0));
  const estimatedKcal = foods.length ? nutrition.kcal : (safe ? 380 : 0);

  return {
    source: 'image',
    isMealImage: foods.length > 0 || /料理|食事|ランチ|朝食|昼食|夕食|弁当/.test(safe),
    imageKind: foods.length ? 'meal_photo' : 'unknown',
    mealType: detectMealType(safe),
    items: foods.map((item) => item.label),
    summaryLabel: buildSummaryLabel(foods, foods.length ? '食事' : '食事写真'),
    amountNote: '',
    amountRatio: 1,
    estimatedNutrition: { kcal: round0(estimatedKcal), protein: 0, fat: 0, carbs: 0 },
    kcalRange,
    comment: '細かい明細ではなく、ざっくりした献立として見ています。',
    ocrText: safe,
    confidence: foods.length ? 0.62 : 0.2,
    recordReady: foods.length > 0,
  };
}

function normalizeImageMeal(parsed, rawText = '') {
  const safeText = sanitizeGeminiText(rawText);
  const items = Array.isArray(parsed?.items)
    ? parsed.items.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  const joined = [safeText, ...items].join(' ');
  const foods = pickMatchedFoods(joined);

  const estimatedKcal = round0(
    parsed?.estimatedNutrition?.kcal ||
    parsed?.estimatedKcal ||
    parsed?.kcal ||
    buildSimpleNutritionFromFoods(foods).kcal ||
    0
  );
  const kcalRange = {
    low: round0(parsed?.kcalLow || parsed?.estimatedKcalLow || buildKcalRange(estimatedKcal).low),
    high: round0(parsed?.kcalHigh || parsed?.estimatedKcalHigh || buildKcalRange(estimatedKcal).high),
  };
  const summaryLabel = normalizeText(parsed?.summaryLabel || parsed?.mealLabel || buildSummaryLabel(foods, '食事写真'));
  const mealLike = Boolean(parsed?.isMealImage || foods.length || summaryLabel);

  return {
    source: 'image',
    isMealImage: mealLike && !LAB_BLOCK_WORDS.some((pattern) => pattern.test(safeText)),
    imageKind: normalizeText(parsed?.imageKind || 'meal_photo') || 'meal_photo',
    mealType: normalizeText(parsed?.mealTypeHint || parsed?.mealType || 'unknown') || 'unknown',
    items: foods.map((item) => item.label),
    summaryLabel,
    amountNote: '',
    amountRatio: 1,
    estimatedNutrition: { kcal: estimatedKcal, protein: 0, fat: 0, carbs: 0 },
    kcalRange,
    comment: normalizeText(parsed?.comment || '細かい明細は省いて、ざっくりした献立として見ています。'),
    ocrText: safeText,
    confidence: Number(parsed?.confidence || (foods.length ? 0.72 : 0.4)),
    recordReady: mealLike,
  };
}

async function analyzeMealImage(imagePayload) {
  const prompt = [
    'この画像が食事なら、細かい一品明細よりも、ざっくりした献立名で返してください。',
    '量は反映しなくて大丈夫です。',
    'JSONのみを返してください。',
    '{',
    '  "isMealImage": true,',
    '  "imageKind": "meal_photo | menu_text | food_package | nutrition_label | unknown",',
    '  "mealTypeHint": "breakfast|lunch|dinner|snack|unknown",',
    '  "summaryLabel": "和食寄りの食事 / ラーメン / カレー など",',
    '  "items": ["料理名を1〜3個まで"],',
    '  "estimatedKcal": 0,',
    '  "estimatedKcalLow": 0,',
    '  "estimatedKcalHigh": 0,',
    '  "comment": "短く",',
    '  "confidence": 0.0',
    '}',
  ].join('\n');

  const result = await geminiImageAnalysisService.analyzeImage({ imagePayload, prompt });
  if (!result.ok) {
    return buildHeuristicImageMeal('');
  }

  const parsed = extractJsonObject(result.text);
  if (!parsed) return buildHeuristicImageMeal(result.text);

  const normalized = normalizeImageMeal(parsed, result.text);
  if (!normalized.isMealImage) {
    const heuristic = buildHeuristicImageMeal(result.text);
    if (heuristic.isMealImage) return heuristic;
  }
  return normalized;
}

module.exports = {
  parseMealText,
  analyzeMealImage,
};
