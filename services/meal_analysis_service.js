'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');

const FOOD_LIBRARY = [
  { keywords: ['味噌ラーメン', 'みそラーメン'], kcal: 560, protein: 20.0, fat: 17.0, carbs: 73.0, unit: '1杯', mealType: 'lunch' },
  { keywords: ['醤油ラーメン', 'しょうゆラーメン'], kcal: 470, protein: 18.0, fat: 12.0, carbs: 66.0, unit: '1杯', mealType: 'lunch' },
  { keywords: ['豚骨ラーメン', 'とんこつラーメン'], kcal: 540, protein: 19.0, fat: 18.0, carbs: 69.0, unit: '1杯', mealType: 'lunch' },
  { keywords: ['ラーメン'], kcal: 480, protein: 18.0, fat: 14.0, carbs: 68.0, unit: '1杯', mealType: 'lunch' },
  { keywords: ['カレーライス', 'カレー'], kcal: 520, protein: 14.0, fat: 16.0, carbs: 76.0, unit: '1皿', mealType: 'lunch' },
  { keywords: ['寿司', 'すし'], kcal: 220, protein: 12.0, fat: 3.0, carbs: 34.0, unit: '5貫', mealType: 'dinner' },
  { keywords: ['おにぎり'], kcal: 180, protein: 3.5, fat: 1.0, carbs: 39.0, unit: '1個', mealType: 'snack' },
  { keywords: ['ごはん', '白米'], kcal: 234, protein: 3.8, fat: 0.5, carbs: 55.2, unit: '1杯', mealType: 'unknown' },
  { keywords: ['食パン', 'トースト', 'パン'], kcal: 156, protein: 5.3, fat: 2.6, carbs: 28.0, unit: '2枚', mealType: 'breakfast' },
  { keywords: ['卵', 'たまご'], kcal: 76, protein: 6.2, fat: 5.2, carbs: 0.2, unit: '1個', mealType: 'breakfast' },
  { keywords: ['味噌汁', 'みそ汁'], kcal: 45, protein: 3.0, fat: 1.5, carbs: 4.0, unit: '1杯', mealType: 'breakfast' },
  { keywords: ['サラダチキン'], kcal: 115, protein: 24.0, fat: 1.2, carbs: 1.3, unit: '1個', mealType: 'snack' },
  { keywords: ['鶏むね', '鶏胸', '鶏肉'], kcal: 160, protein: 28.0, fat: 3.5, carbs: 0.0, unit: '100g', mealType: 'dinner' },
  { keywords: ['鮭', 'さけ', 'サーモン'], kcal: 180, protein: 20.0, fat: 10.0, carbs: 0.0, unit: '1切れ', mealType: 'dinner' },
  { keywords: ['魚'], kcal: 160, protein: 18.0, fat: 9.0, carbs: 0.0, unit: '1切れ', mealType: 'dinner' },
  { keywords: ['ヨーグルト'], kcal: 90, protein: 4.0, fat: 3.0, carbs: 12.0, unit: '1個', mealType: 'breakfast' },
  { keywords: ['プロテイン'], kcal: 120, protein: 20.0, fat: 2.0, carbs: 6.0, unit: '1杯', mealType: 'snack' },
  { keywords: ['バナナ'], kcal: 86, protein: 1.1, fat: 0.2, carbs: 22.5, unit: '1本', mealType: 'snack' },
  { keywords: ['納豆'], kcal: 90, protein: 7.4, fat: 4.5, carbs: 5.4, unit: '1パック', mealType: 'breakfast' },
  { keywords: ['豆腐'], kcal: 72, protein: 6.6, fat: 4.2, carbs: 1.7, unit: '150g', mealType: 'dinner' },
  { keywords: ['うどん'], kcal: 320, protein: 8.0, fat: 5.0, carbs: 58.0, unit: '1杯', mealType: 'lunch' },
  { keywords: ['そば'], kcal: 300, protein: 12.0, fat: 4.0, carbs: 52.0, unit: '1杯', mealType: 'lunch' },
  { keywords: ['鍋'], kcal: 320, protein: 24.0, fat: 12.0, carbs: 18.0, unit: '1人前', mealType: 'dinner' },
  { keywords: ['サラダ'], kcal: 80, protein: 2.5, fat: 4.0, carbs: 7.0, unit: '1皿', mealType: 'dinner' }
];

const FRACTION_PATTERNS = [
  { pattern: /(?:半分|半分だけ|半分くらい|1\/2)/, ratio: 0.5, note: '半分' },
  { pattern: /(?:3割|3\/10)/, ratio: 0.3, note: '3割' },
  { pattern: /(?:1\/3|3分の1)/, ratio: 0.33, note: '1/3' },
  { pattern: /(?:2\/3|3分の2)/, ratio: 0.67, note: '2/3' },
  { pattern: /(?:少し|ちょっと|ひとくち|一口)/, ratio: 0.35, note: '少し' },
  { pattern: /(?:少なめ|軽め)/, ratio: 0.8, note: '少なめ' },
  { pattern: /(?:多め)/, ratio: 1.3, note: '多め' },
  { pattern: /(?:大盛り|特盛)/, ratio: 1.5, note: '大盛り' },
  { pattern: /(?:2人前|二人前|2倍)/, ratio: 2.0, note: '2人前' },
  { pattern: /(?:全部|完食)/, ratio: 1.0, note: '全部' }
];

function normalizeText(value) {
  return String(value || '').trim();
}

function toHalfWidth(text) {
  return normalizeText(text).replace(/[０-９．％／]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function detectMealType(text) {
  const safeText = normalizeText(text);
  if (/朝|朝ごはん|朝食|モーニング/.test(safeText)) return 'breakfast';
  if (/昼|昼ごはん|昼食|ランチ/.test(safeText)) return 'lunch';
  if (/夜|夕食|晩ごはん|ディナー/.test(safeText)) return 'dinner';
  if (/間食|おやつ|補食/.test(safeText)) return 'snack';
  return 'unknown';
}

function detectAmount(text) {
  const safeText = toHalfWidth(text);

  for (const entry of FRACTION_PATTERNS) {
    if (entry.pattern.test(safeText)) {
      return { ratio: entry.ratio, note: entry.note };
    }
  }

  const numericFraction = safeText.match(/([0-9]+(?:\.[0-9]+)?)\s*割/);
  if (numericFraction) {
    const ratio = Number(numericFraction[1]) / 10;
    if (ratio > 0 && ratio <= 3) {
      return { ratio: round2(ratio), note: `${numericFraction[1]}割` };
    }
  }

  return { ratio: 1, note: '' };
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
  const used = new Set();

  for (const food of FOOD_LIBRARY) {
    if (food.keywords.some((kw) => safeText.includes(kw))) {
      const name = food.keywords[0];
      if (used.has(name)) continue;
      used.add(name);
      found.push({
        name,
        kcal: food.kcal,
        protein: food.protein,
        fat: food.fat,
        carbs: food.carbs,
        unit: food.unit,
        mealType: food.mealType || 'unknown'
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

  if (/食べた|飲んだ|朝ごはん|昼ごはん|夜ごはん|間食/.test(safeText)) confidence += 0.08;
  if (matchedFoods.length >= 2) confidence += 0.08;
  if (matchedFoods.length >= 1) confidence += 0.12;
  if (/半分|少し|全部|完食|少なめ|多め|大盛り/.test(safeText)) confidence += 0.05;

  return Math.min(0.94, confidence);
}

function buildParsedMealResult(text, matchedFoods, amount) {
  const totals = sumNutrition(matchedFoods, amount.ratio);
  const textMealType = detectMealType(text);
  const inferredMealType = textMealType !== 'unknown'
    ? textMealType
    : (matchedFoods[0]?.mealType || 'unknown');

  return {
    source: 'text',
    isMealText: matchedFoods.length > 0,
    mealType: inferredMealType,
    items: matchedFoods.map((f) => f.name),
    amountRatio: amount.ratio,
    amountNote: amount.note,
    estimatedNutrition: {
      kcal: round1(totals.kcal),
      protein: round1(totals.protein),
      fat: round1(totals.fat),
      carbs: round1(totals.carbs)
    },
    confidence: addHeuristicBoost(text, matchedFoods, matchedFoods.length ? 0.5 : 0.12)
  };
}

function parseMealText(text) {
  const safeText = normalizeText(text);
  const amount = detectAmount(safeText);
  const matchedFoods = findFoodsFromText(safeText);

  return buildParsedMealResult(safeText, matchedFoods, amount);
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

  const result = await geminiImageAnalysisService.analyzeImage({ imagePayload, prompt });

  if (!result?.ok) {
    return {
      source: 'image',
      isMealImage: false,
      mealType: 'unknown',
      items: [],
      amountNote: '',
      estimatedNutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
      comment: '',
      confidence: 0
    };
  }

  const parsed = extractJsonObject(result.text);
  if (!parsed) {
    return {
      source: 'image',
      isMealImage: false,
      mealType: 'unknown',
      items: [],
      amountNote: '',
      estimatedNutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
      comment: '',
      confidence: 0
    };
  }

  return {
    source: 'image',
    isMealImage: Boolean(parsed.isMealImage),
    mealType: parsed.mealTypeHint || 'unknown',
    items: Array.isArray(parsed.items) ? parsed.items.filter(Boolean) : [],
    amountNote: normalizeText(parsed.amountNote || ''),
    estimatedNutrition: {
      kcal: round1(parsed?.estimatedNutrition?.kcal || 0),
      protein: round1(parsed?.estimatedNutrition?.protein || 0),
      fat: round1(parsed?.estimatedNutrition?.fat || 0),
      carbs: round1(parsed?.estimatedNutrition?.carbs || 0)
    },
    comment: normalizeText(parsed.comment || ''),
    confidence: Number(parsed.confidence || 0)
  };
}

module.exports = {
  parseMealText,
  analyzeMealImage,
  detectMealType,
  detectAmount,
  findFoodsFromText
};
