'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
let analyzeMealImageWithAI = null;
try {
  ({ analyzeMealImageWithAI } = require('./meal_image_ai_service'));
} catch (_) {
  analyzeMealImageWithAI = null;
}

const FOOD_LIBRARY = [
  { keywords: ['カレーライス', 'カレー'], kcal: 520, protein: 14.0, fat: 16.0, carbs: 76.0, unit: '1皿' },
  { keywords: ['ラーメン', '塩ラーメン', '味噌ラーメン', '醤油ラーメン', '豚骨ラーメン'], kcal: 520, protein: 19.0, fat: 15.5, carbs: 70.5, unit: '1杯' },
  { keywords: ['フォー'], kcal: 420, protein: 14.0, fat: 8.0, carbs: 72.0, unit: '1杯' },
  { keywords: ['ごはん', '白米', 'ライス'], kcal: 234, protein: 3.8, fat: 0.5, carbs: 55.2, unit: '1杯' },
  { keywords: ['食パン', 'パン', 'トースト'], kcal: 156, protein: 5.3, fat: 2.6, carbs: 28.0, unit: '2枚' },
  { keywords: ['卵', 'たまご', '目玉焼き', 'ゆで卵'], kcal: 76, protein: 6.2, fat: 5.2, carbs: 0.2, unit: '1個' },
  { keywords: ['味噌汁', 'みそ汁'], kcal: 45, protein: 3.0, fat: 1.5, carbs: 4.0, unit: '1杯' },
  { keywords: ['鍋'], kcal: 320, protein: 24.0, fat: 12.0, carbs: 18.0, unit: '1人前' },
  { keywords: ['サラダ', '千切りキャベツ', 'キャベツ'], kcal: 80, protein: 2.5, fat: 4.0, carbs: 7.0, unit: '1皿' },
  { keywords: ['鶏むね', '鶏胸', 'サラダチキン', '鶏肉', '鶏むね肉'], kcal: 160, protein: 28.0, fat: 3.5, carbs: 0.0, unit: '100g' },
  { keywords: ['豚肉'], kcal: 180, protein: 18.0, fat: 11.0, carbs: 0.0, unit: '100g' },
  { keywords: ['魚', '鮭', 'さけ', 'サーモン'], kcal: 180, protein: 20.0, fat: 10.0, carbs: 0.0, unit: '1切れ' },
  { keywords: ['ヨーグルト'], kcal: 90, protein: 4.0, fat: 3.0, carbs: 12.0, unit: '1個' },
  { keywords: ['プロテイン'], kcal: 120, protein: 20.0, fat: 2.0, carbs: 6.0, unit: '1杯' },
  { keywords: ['寿司', 'すし'], kcal: 220, protein: 12.0, fat: 3.0, carbs: 34.0, unit: '5貫' },
  { keywords: ['バナナ'], kcal: 86, protein: 1.1, fat: 0.2, carbs: 22.5, unit: '1本' },
  { keywords: ['いちご', '苺'], kcal: 34, protein: 0.8, fat: 0.1, carbs: 8.5, unit: '100g' },
  { keywords: ['納豆'], kcal: 90, protein: 7.4, fat: 4.5, carbs: 5.4, unit: '1パック' },
  { keywords: ['豆腐'], kcal: 72, protein: 6.6, fat: 4.2, carbs: 1.7, unit: '150g' },
  { keywords: ['おにぎり'], kcal: 180, protein: 3.5, fat: 1.0, carbs: 39.0, unit: '1個' },
  { keywords: ['うどん'], kcal: 320, protein: 8.0, fat: 5.0, carbs: 58.0, unit: '1杯' },
  { keywords: ['そば'], kcal: 300, protein: 12.0, fat: 4.0, carbs: 52.0, unit: '1杯' },
  { keywords: ['パスタ', 'スパゲティ'], kcal: 520, protein: 17.0, fat: 14.0, carbs: 74.0, unit: '1皿' },
  { keywords: ['弁当', '唐揚げ弁当'], kcal: 780, protein: 28.0, fat: 31.0, carbs: 94.0, unit: '1食' },
  { keywords: ['ソーセージ', 'ウインナー'], kcal: 120, protein: 5.0, fat: 10.0, carbs: 1.5, unit: '2本' },
  { keywords: ['ブロッコリー'], kcal: 33, protein: 4.3, fat: 0.5, carbs: 5.2, unit: '100g' },
  { keywords: ['パプリカ'], kcal: 30, protein: 1.0, fat: 0.2, carbs: 7.2, unit: '100g' },
  { keywords: ['アスパラ'], kcal: 22, protein: 2.6, fat: 0.2, carbs: 3.9, unit: '100g' },
  { keywords: ['マヨネーズ'], kcal: 70, protein: 0.1, fat: 7.5, carbs: 0.2, unit: '大さじ1/2' },
];

const FRACTION_MAP = {
  '半分': 0.5,
  '半分だけ': 0.5,
  '半分くらい': 0.5,
  '少し': 0.7,
  '少なめ': 0.7,
  '軽め': 0.8,
  '多め': 1.3,
  '大盛り': 1.5,
  '全部': 1.0,
  '完食': 1.0,
  '一杯': 1.0,
  '一皿': 1.0,
  '1杯': 1.0,
  '1皿': 1.0,
  '1/3': 0.33,
  '２/３': 0.67,
  '2/3': 0.67,
  '3割': 0.3,
  '7割': 0.7,
  '2人前': 2.0
};

const FOOD_WORDS = [
  'ラーメン','フォー','ごはん','味噌汁','サラダ','パスタ','唐揚げ','弁当','おにぎり','寿司','カレー','パン','ヨーグルト','バナナ','納豆','豆腐','スープ','鶏','豚','魚','鮭','サーモン','いちご','ソーセージ','ウインナー','ブロッコリー','パプリカ','アスパラ','卵','たまご','目玉焼き'
];

function normalizeText(value) { return String(value || '').trim(); }
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
function clamp01(n) { return Math.min(1, Math.max(0, Number(n || 0))); }
function sanitizeGeminiText(text) { return String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim(); }
function extractJsonObject(text) {
  const safe = sanitizeGeminiText(text);
  const start = safe.indexOf('{');
  const end = safe.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(safe.slice(start, end + 1)); } catch (_) { return null; }
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

function parseNutritionText(text) {
  const safe = normalizeText(text);
  return {
    kcal: round1((safe.match(/([0-9]+(?:\.[0-9]+)?)\s*kcal/i) || [])[1] || 0),
    protein: round1((safe.match(/たんぱく質\s*([0-9]+(?:\.[0-9]+)?)\s*g/i) || [])[1] || 0),
    fat: round1((safe.match(/脂質\s*([0-9]+(?:\.[0-9]+)?)\s*g/i) || [])[1] || 0),
    carbs: round1((safe.match(/(?:糖質|炭水化物)\s*([0-9]+(?:\.[0-9]+)?)\s*g/i) || [])[1] || 0)
  };
}

function estimateNutritionFromItemNames(items, ratio = 1) {
  const matched = [];
  for (const item of (items || [])) {
    const safe = normalizeText(item);
    const hit = FOOD_LIBRARY.find((food) => food.keywords.some((kw) => safe.includes(kw) || kw.includes(safe)));
    if (hit) matched.push(hit);
  }
  return sumNutrition(matched, ratio);
}

function buildHeuristicImageMeal(rawText) {
  const safe = sanitizeGeminiText(rawText);
  const nutrition = parseNutritionText(safe);
  const foods = findFoodsFromText(safe);
  const looksLikeFoodText = foods.length > 0 || FOOD_WORDS.some((word) => safe.includes(word));
  const hasNutritionFacts = Boolean(nutrition.kcal || nutrition.protein || nutrition.fat || nutrition.carbs);
  const estimated = hasNutritionFacts ? nutrition : {
    kcal: round1(sumNutrition(foods, 1).kcal),
    protein: round1(sumNutrition(foods, 1).protein),
    fat: round1(sumNutrition(foods, 1).fat),
    carbs: round1(sumNutrition(foods, 1).carbs)
  };
  return {
    source: 'image',
    isMealImage: looksLikeFoodText || hasNutritionFacts,
    imageKind: hasNutritionFacts ? 'nutrition_label' : (looksLikeFoodText ? 'menu_text' : 'unknown'),
    mealType: detectMealType(safe),
    items: foods.length ? foods.map((item) => item.name) : FOOD_WORDS.filter((word) => safe.includes(word)).slice(0, 8),
    amountNote: '',
    amountRatio: 1,
    estimatedNutrition: estimated,
    comment: hasNutritionFacts ? 'パッケージや成分表示の文字も参考にしました。' : '画像や読めた文字から候補を拾っています。',
    ocrText: safe,
    confidence: hasNutritionFacts ? 0.78 : (looksLikeFoodText ? 0.56 : 0.18),
    recordReady: hasNutritionFacts || foods.length > 0
  };
}

function normalizeImageMeal(parsed) {
  const itemNames = Array.isArray(parsed?.items)
    ? parsed.items.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  const amountRatio = Number(parsed?.amountRatio || 1) || 1;

  let estimatedNutrition = {
    kcal: round1(parsed?.estimatedNutrition?.kcal || 0),
    protein: round1(parsed?.estimatedNutrition?.protein || 0),
    fat: round1(parsed?.estimatedNutrition?.fat || 0),
    carbs: round1(parsed?.estimatedNutrition?.carbs || 0)
  };

  if ((!estimatedNutrition.kcal || !estimatedNutrition.protein) && itemNames.length) {
    const fallback = estimateNutritionFromItemNames(itemNames, amountRatio);
    estimatedNutrition = {
      kcal: round1(estimatedNutrition.kcal || fallback.kcal),
      protein: round1(estimatedNutrition.protein || fallback.protein),
      fat: round1(estimatedNutrition.fat || fallback.fat),
      carbs: round1(estimatedNutrition.carbs || fallback.carbs)
    };
  }

  const imageKind = normalizeText(parsed?.imageKind || parsed?.sourceKind || 'meal_photo') || 'meal_photo';
  const inferredMealSignal = itemNames.length > 0 || estimatedNutrition.kcal > 0 || FOOD_WORDS.some((word) => normalizeText(parsed?.ocrText || '').includes(word));

  return {
    source: 'image',
    isMealImage: Boolean(parsed?.isMealImage || parsed?.is_meal || inferredMealSignal),
    imageKind,
    mealType: normalizeText(parsed?.mealTypeHint || parsed?.mealType || 'unknown') || 'unknown',
    items: itemNames,
    amountNote: normalizeText(parsed?.amountNote || ''),
    amountRatio,
    estimatedNutrition,
    comment: normalizeText(parsed?.comment || parsed?.ai_comment || ''),
    ocrText: normalizeText(parsed?.ocrText || ''),
    confidence: clamp01(Number(parsed?.confidence || 0)),
    recordReady: parsed?.recordReady != null ? Boolean(parsed.recordReady) : ['meal_photo', 'food_package', 'nutrition_label'].includes(imageKind)
  };
}

function mapMealImageAIResult(ai) {
  const items = Array.isArray(ai?.food_items)
    ? ai.food_items.map((item) => normalizeText(item?.name)).filter(Boolean)
    : [];

  let estimatedNutrition = {
    kcal: round1(ai?.estimated_kcal || 0),
    protein: round1(ai?.protein_g || 0),
    fat: round1(ai?.fat_g || 0),
    carbs: round1(ai?.carbs_g || 0)
  };

  if ((!estimatedNutrition.kcal || !estimatedNutrition.protein) && items.length) {
    const fallback = estimateNutritionFromItemNames(items, 1);
    estimatedNutrition = {
      kcal: round1(estimatedNutrition.kcal || fallback.kcal),
      protein: round1(estimatedNutrition.protein || fallback.protein),
      fat: round1(estimatedNutrition.fat || fallback.fat),
      carbs: round1(estimatedNutrition.carbs || fallback.carbs)
    };
  }

  return {
    source: 'image',
    isMealImage: Boolean(ai?.is_meal || items.length || estimatedNutrition.kcal),
    imageKind: 'meal_photo',
    mealType: 'unknown',
    items,
    amountNote: '',
    amountRatio: 1,
    estimatedNutrition,
    comment: normalizeText(ai?.ai_comment || '写真からざっくり整理しました。'),
    ocrText: '',
    confidence: clamp01(Number(ai?.confidence || 0.55)),
    recordReady: true
  };
}

async function analyzeMealImage(imagePayload) {
  if (analyzeMealImageWithAI && imagePayload?.buffer) {
    try {
      const aiResult = await analyzeMealImageWithAI(imagePayload.buffer, imagePayload.mimeType || 'image/jpeg');
      const mapped = normalizeImageMeal(mapMealImageAIResult(aiResult));
      if (mapped.isMealImage && (mapped.items.length || mapped.estimatedNutrition.kcal > 0)) return mapped;
    } catch (error) {
      console.error('[meal_analysis_service] meal_image_ai_service fallback:', error?.message || error);
    }
  }

  const prompt = [
    'この画像が食事関連なら、食事写真だけでなく、メニュー表、商品パッケージ、栄養成分表示、食品名ラベルも対象にしてください。',
    '画像の中の文字も必ず読み取って判断してください。',
    'カロリーが断定しにくい時も 0 にせず、写真から見える内容の現実的な中央値で推定してください。',
    '料理名は一般名より具体名を優先してください。例: カレーライス、目玉焼き、豆腐、千切りキャベツ。',
    'JSONのみを返してください。',
    '{',
    '  "isMealImage": true,',
    '  "imageKind": "meal_photo | menu_text | food_package | nutrition_label | unknown",',
    '  "mealTypeHint": "breakfast|lunch|dinner|snack|unknown",',
    '  "items": ["料理1", "料理2"],',
    '  "amountNote": "少なめ/半分/標準/多め など",',
    '  "amountRatio": 1.0,',
    '  "estimatedNutrition": { "kcal": 0, "protein": 0, "fat": 0, "carbs": 0 },',
    '  "ocrText": "読めた文字を短く",',
    '  "comment": "簡潔に",',
    '  "recordReady": true,',
    '  "confidence": 0.0',
    '}'
  ].join('\n');

  const result = await geminiImageAnalysisService.analyzeImage({ imagePayload, prompt });
  if (!result.ok) {
    return {
      source: 'image',
      isMealImage: false,
      imageKind: 'unknown',
      items: [],
      estimatedNutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
      confidence: 0,
      recordReady: false
    };
  }

  const parsed = extractJsonObject(result.text);
  if (!parsed) return buildHeuristicImageMeal(result.text);

  const normalized = normalizeImageMeal(parsed);
  if (!normalized.isMealImage || (!normalized.items.length && normalized.estimatedNutrition.kcal <= 0)) {
    const heuristic = buildHeuristicImageMeal(result.text);
    if (heuristic.isMealImage) return heuristic;
  }

  return normalized;
}

module.exports = {
  parseMealText,
  analyzeMealImage
};
