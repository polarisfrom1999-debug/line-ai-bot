'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');

const FOOD_LIBRARY = [
  { keywords: ['ごはん', '白米'], kcal: 234, protein: 3.8, fat: 0.5, carbs: 55.2 },
  { keywords: ['食パン', 'パン'], kcal: 156, protein: 5.3, fat: 2.6, carbs: 28.0 },
  { keywords: ['卵', 'たまご'], kcal: 76, protein: 6.2, fat: 5.2, carbs: 0.2 },
  { keywords: ['味噌汁', 'みそ汁'], kcal: 45, protein: 3.0, fat: 1.5, carbs: 4.0 },
  { keywords: ['ラーメン'], kcal: 480, protein: 18.0, fat: 14.0, carbs: 68.0 },
  { keywords: ['カレー'], kcal: 520, protein: 14.0, fat: 16.0, carbs: 76.0 },
  { keywords: ['鍋'], kcal: 320, protein: 24.0, fat: 12.0, carbs: 18.0 },
  { keywords: ['サラダ'], kcal: 80, protein: 2.5, fat: 4.0, carbs: 7.0 },
  { keywords: ['鶏むね', '鶏胸', 'サラダチキン', '鶏肉'], kcal: 160, protein: 28.0, fat: 3.5, carbs: 0.0 },
  { keywords: ['魚', '鮭', 'さけ', 'サーモン'], kcal: 180, protein: 20.0, fat: 10.0, carbs: 0.0 },
  { keywords: ['ヨーグルト'], kcal: 90, protein: 4.0, fat: 3.0, carbs: 12.0 },
  { keywords: ['プロテイン'], kcal: 120, protein: 20.0, fat: 2.0, carbs: 6.0 },
  { keywords: ['寿司', 'すし'], kcal: 220, protein: 12.0, fat: 3.0, carbs: 34.0 }
];

const FRACTION_MAP = {
  '半分': 0.5,
  '半分だけ': 0.5,
  '少し': 0.7,
  '軽め': 0.8,
  '多め': 1.3,
  '大盛り': 1.5,
  '一杯': 1.0,
  '一杯食べた': 1.0,
  '一杯食べたよ': 1.0
};

function normalizeText(value) {
  return String(value || '').trim();
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

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
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
        carbs: food.carbs
      });
    }
  }

  return found;
}

function parseMealText(text) {
  const safeText = normalizeText(text);
  const fraction = detectFraction(safeText);
  const matchedFoods = findFoodsFromText(safeText);
  const totals = sumNutrition(matchedFoods, fraction);

  return {
    source: 'text',
    mealType: detectMealType(safeText),
    items: matchedFoods.map((f) => f.name),
    amountRatio: fraction,
    estimatedNutrition: {
      kcal: round1(totals.kcal),
      protein: round1(totals.protein),
      fat: round1(totals.fat),
      carbs: round1(totals.carbs)
    },
    confidence: matchedFoods.length ? 0.72 : 0.18
  };
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
  } catch (_) {
    return null;
  }
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
