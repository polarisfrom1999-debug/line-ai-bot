services/meal_analysis_service.js
'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');

const FOOD_LIBRARY = [
  { keywords: ['ごはん', '白米'], kcal: 234, protein: 3.8, fat: 0.5, carbs: 55.2, unit: '1杯' },
  { keywords: ['食パン', 'パン'], kcal: 156, protein: 5.3, fat: 2.6, carbs: 28.0, unit: '2枚' },
  { keywords: ['卵', 'たまご'], kcal: 76, protein: 6.2, fat: 5.2, carbs: 0.2, unit: '1個' },
  { keywords: ['味噌汁', 'みそ汁'], kcal: 45, protein: 3.0, fat: 1.5, carbs: 4.0, unit: '1杯' },
  { keywords: ['ラーメン', '味噌ラーメン', '醤油ラーメン', '豚骨ラーメン'], kcal: 480, protein: 18.0, fat: 14.0, carbs: 68.0, unit: '1杯' },
  { keywords: ['カレー', 'カレーライス'], kcal: 520, protein: 14.0, fat: 16.0, carbs: 76.0, unit: '1皿' },
  { keywords: ['鍋'], kcal: 320, protein: 24.0, fat: 12.0, carbs: 18.0, unit: '1人前' },
  { keywords: ['サラダ'], kcal: 80, protein: 2.5, fat: 4.0, carbs: 7.0, unit: '1皿' },
  { keywords: ['鶏むね', '鶏胸', 'サラダチキン', '鶏肉'], kcal: 160, protein: 28.0, fat: 3.5, carbs: 0.0, unit: '100g' },
  { keywords: ['魚', '鮭', 'さけ', 'サーモン'], kcal: 180, protein: 20.0, fat: 10.0, carbs: 0.0, unit: '1切れ' },
  { keywords: ['ヨーグルト'], kcal: 90, protein: 4.0, fat: 3.0, carbs: 12.0, unit: '1個' },
  { keywords: ['プロテイン'], kcal: 120, protein: 20.0, fat: 2.0, carbs: 6.0, unit: '1杯' },
  { keywords: ['寿司', 'すし'], kcal: 220, protein: 12.0, fat: 3.0, carbs: 34.0, unit: '5貫' },
  { keywords: ['バナナ'], kcal: 86, protein: 1.1, fat: 0.2, carbs: 22.5, unit: '1本' },
  { keywords: ['納豆'], kcal: 90, protein: 7.4, fat: 4.5, carbs: 5.4, unit: '1パック' },
  { keywords: ['豆腐'], kcal: 72, protein: 6.6, fat: 4.2, carbs: 1.7, unit: '150g' },
  { keywords: ['おにぎり'], kcal: 180, protein: 3.5, fat: 1.0, carbs: 39.0, unit: '1個' },
  { keywords: ['うどん'], kcal: 320, protein: 8.0, fat: 5.0, carbs: 58.0, unit: '1杯' },
  { keywords: ['そば'], kcal: 300, protein: 12.0, fat: 4.0, carbs: 52.0, unit: '1杯' }
];

const FRACTION_MAP = {
  '半分': 0.5,
  '半分だけ': 0.5,
  '半分くらい': 0.5,
  '少し': 0.7,
  '少なめ': 0.8,
  '軽め': 0.8,
  '多め': 1.3,
  '大盛り': 1.5,
  '全部': 1.0,
  '完食': 1.0,
  '一杯': 1.0,
  '一皿': 1.0,
  '1杯': 1.0,
  '1皿': 1.0
};

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function detectFraction(text) {
  const safeText = normalizeText(text);
  for (const [key, value] of Object.entries(FRACTION_MAP)) {
    if (safeText.includes(key)) return value;
  }
  return 1;
}

function detectMealType(text) {
  const safeText = normalizeText(text);
  if (/朝|朝ごはん|朝食/.test(safeText)) return 'breakfast';
  if (/昼|昼ごはん|昼食|ランチ/.test(safeText)) return 'lunch';
  if (/夜|夕食|晩ごはん|ディナー/.test(safeText)) return 'dinner';
  if (/間食|おやつ/.test(safeText)) return 'snack';
  return 'unknown';
}

function sumNutrition(items, fraction = 1) {
  return items.reduce((acc, item) => {
    acc.kcal += (item.kcal || 0) * fraction;
    acc.protein += (item.protein || 0) * fraction;
    acc.fat += (item.fat || 0) * fraction;
    acc.carbs += (item.carbs || 0) * fraction;
    return acc;
  }, { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}

function findFoodsFromText(text) {
  const safeText = normalizeText(text);
  const found = [];

  for (const food of FOOD_LIBRARY) {
    if (food.keywords.some((kw) => safeText.includes(kw))) {
      found.push({
        name: food.keywords[0],
        kcal: food.kcal,
        protein: food.protein,
        fat: food.fat,
        carbs: food.carbs,
        unit: food.unit
      });
    }
  }

  return found;
}

function sanitizeGeminiText(text) {
  return String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

function extractJsonObject(text) {
  const safe = sanitizeGeminiText(text);
  const start = safe.indexOf('{');
  const end = safe.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(safe.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function addHeuristicBoost(text, matchedFoods, baseConfidence) {
  const safeText = normalizeText(text);
  let confidence = baseConfidence;

  if (/食べた|飲んだ|朝ごはん|昼ごはん|夜ごはん/.test(safeText)) confidence += 0.08;
  if (matchedFoods.length >= 2) confidence += 0.08;
  if (matchedFoods.length >= 1) confidence += 0.12;
  if (/半分|少し|全部|完食/.test(safeText)) confidence += 0.04;

  return Math.min(0.92, confidence);
}

function parseMealText(text) {
  const safeText = normalizeText(text);
  const fraction = detectFraction(safeText);
  const matchedFoods = findFoodsFromText(safeText);
  const totals = sumNutrition(matchedFoods, fraction);

  const amountNote = Object.keys(FRACTION_MAP).find((key) => safeText.includes(key)) || '';
  const confidence = addHeuristicBoost(safeText, matchedFoods, matchedFoods.length ? 0.48 : 0.12);

  return {
    source: 'text',
    isMealText: matchedFoods.length > 0,
    mealType: detectMealType(safeText),
    items: matchedFoods.map((f) => f.name),
    amountRatio: fraction,
    amountNote,
    estimatedNutrition: {
      kcal: round1(totals.kcal),
      protein: round1(totals.protein),
      fat: round1(totals.fat),
      carbs: round1(totals.carbs)
    },
    confidence
  };
}

async function analyzeMealImage(imagePayload) {
  const prompt = [
    'この画像が食事写真なら、料理候補・量感・概算栄養をJSONで返してください。',
    'JSONのみを返してください。',
    '{',
    '  "isMealImage": true,',
    '  "mealTypeHint": "breakfast|lunch|dinner|snack|unknown",',
    '  "items": ["料理1","料理2"],',
    '  "amountNote": "少なめ/半分/標準/多め など",',
    '  "estimatedNutrition": {',
    '    "kcal": 0,',
    '    "protein": 0,',
    '    "fat": 0,',
    '    "carbs": 0',
    '  },',
    '  "comment": "簡潔に",',
    '  "confidence": 0.0',
    '}'
  ].join('\n');

  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt
  });

  if (!result.ok) {
    return {
      source: 'image',
      isMealImage: false,
      items: [],
      estimatedNutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
      confidence: 0
    };
  }

  const parsed = extractJsonObject(result.text);
  if (!parsed) {
    return {
      source: 'image',
      isMealImage: false,
      items: [],
      estimatedNutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
      confidence: 0
    };
  }

  return {
    source: 'image',
    isMealImage: Boolean(parsed.isMealImage),
    mealType: parsed.mealTypeHint || 'unknown',
    items: Array.isArray(parsed.items) ? parsed.items : [],
    amountNote: parsed.amountNote || '',
    estimatedNutrition: {
      kcal: round1(parsed?.estimatedNutrition?.kcal || 0),
      protein: round1(parsed?.estimatedNutrition?.protein || 0),
      fat: round1(parsed?.estimatedNutrition?.fat || 0),
      carbs: round1(parsed?.estimatedNutrition?.carbs || 0)
    },
    comment: parsed.comment || '',
    confidence: Number(parsed.confidence || 0)
  };
}

module.exports = {
  parseMealText,
  analyzeMealImage
};
