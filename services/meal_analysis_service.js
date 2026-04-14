'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { buildFullMealReport } = require('./meal_report_service');
const { supabase } = require('./supabase_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function buildFallbackMeal(reason = 'fallback') {
  return {
    isMealImage: true,
    items: ['食事画像（仮推定）'],
    estimatedNutrition: {
      kcal: 450,
      protein: 20,
      fat: 12,
      carbs: 50,
    },
    estimated_nutrition: {
      kcal: 450,
      protein: 20,
      fat: 12,
      carbs: 50,
    },
    comment: /503|429|timeout|unavailable|busy/i.test(String(reason || ''))
      ? '今は画像解析が混み合っていたため、仮の推定で受け止めています。少し時間をあけて再送してもらえると、もう少し細かく見られます。'
      : '一時的に自動推定モードで動作しています。',
    imageKind: 'meal_photo',
    amountRatio: 1,
    amountNote: '',
    recordReady: true,
    reason,
  };
}

function normalizeMealData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return buildFallbackMeal('invalid_meal_object');
  }

  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => normalizeText(item)).filter(Boolean)
    : [];

  const sourceNutrition = raw.estimatedNutrition || raw.estimated_nutrition || {};

  const normalizedNutrition = {
    kcal: normalizeNumber(sourceNutrition.kcal, 450),
    protein: normalizeNumber(sourceNutrition.protein, 20),
    fat: normalizeNumber(sourceNutrition.fat, 12),
    carbs: normalizeNumber(sourceNutrition.carbs, 50),
  };

  return {
    isMealImage: raw.isMealImage !== false,
    items: items.length ? items : ['食事画像（仮推定）'],
    estimatedNutrition: normalizedNutrition,
    estimated_nutrition: normalizedNutrition,
    comment: normalizeText(raw.comment || '') || '今日もひとつ記録できましたね。',
    imageKind: normalizeText(raw.imageKind || '') || 'meal_photo',
    amountRatio: normalizeNumber(raw.amountRatio, 1),
    amountNote: normalizeText(raw.amountNote || ''),
    recordReady: raw.recordReady !== false,
    reason: normalizeText(raw.reason || ''),
    raw,
  };
}

async function saveMealToDb(mealData, userId) {
  if (!mealData?.isMealImage || !userId) return;

  try {
    await supabase.from('meals').insert({
      user_id: userId,
      meal_label: (mealData.items || []).join('、'),
      estimated_kcal: mealData.estimatedNutrition?.kcal || 0,
      protein_g: mealData.estimatedNutrition?.protein || 0,
      fat_g: mealData.estimatedNutrition?.fat || 0,
      carbs_g: mealData.estimatedNutrition?.carbs || 0,
      ai_comment: mealData.comment,
      created_at: new Date().toISOString(),
    });
  } catch (dbErr) {
    console.error('[meal_analysis_service] DB保存スキップ:', dbErr?.message || dbErr);
  }
}

function detectMealType(text) {
  const safe = normalizeText(text);
  if (/朝ごはん|朝食/.test(safe)) return 'breakfast';
  if (/昼ごはん|昼食|ランチ/.test(safe)) return 'lunch';
  if (/夜ごはん|夕食|夕飯|晩ごはん/.test(safe)) return 'dinner';
  return 'unknown';
}

function cleanMealText(text) {
  return normalizeText(text)
    .replace(/^(朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|夕飯|晩ごはん)[:：]?/g, '')
    .replace(/(を)?(食べた|食べました|食べたよ|食べています|食べてる|でした)$/g, '')
    .trim();
}

function splitMealItems(text) {
  const safe = cleanMealText(text);
  if (!safe) return [];

  const normalized = safe
    .replace(/[・]/g, '、')
    .replace(/[／/]/g, '、')
    .replace(/[,
]/g, '、');

  const parts = normalized
    .split('、')
    .map((item) => normalizeText(item))
    .filter(Boolean);

  if (parts.length > 1) return parts;

  return safe
    .split(/\n+/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function estimateItemNutrition(item) {
  const safe = normalizeText(item);
  if (!safe) return { kcal: 0, protein: 0, fat: 0, carbs: 0 };

  const table = [
    [/醤油ラーメン|ラーメン/, { kcal: 550, protein: 20, fat: 18, carbs: 70 }],
    [/オムライス/, { kcal: 750, protein: 20, fat: 30, carbs: 85 }],
    [/カレー/, { kcal: 650, protein: 18, fat: 20, carbs: 90 }],
    [/ハムチーズサンド|サンド/, { kcal: 320, protein: 14, fat: 16, carbs: 30 }],
    [/ヨーグルト/, { kcal: 80, protein: 4, fat: 3, carbs: 10 }],
    [/ウインナー|ソーセージ/, { kcal: 140, protein: 5, fat: 12, carbs: 2 }],
    [/パイナップル|果物|フルーツ/, { kcal: 50, protein: 0, fat: 0, carbs: 12 }],
    [/ポテトサラダ/, { kcal: 180, protein: 4, fat: 11, carbs: 18 }],
    [/卵サラダ|たまごサラダ|玉子サラダ/, { kcal: 170, protein: 7, fat: 13, carbs: 6 }],
    [/サラダ/, { kcal: 90, protein: 3, fat: 6, carbs: 7 }],
    [/胡麻和え|ごま和え/, { kcal: 70, protein: 2, fat: 4, carbs: 6 }],
    [/しらたき.*炒め|しらたき/, { kcal: 40, protein: 1, fat: 1, carbs: 8 }],
    [/煮物|煮$/, { kcal: 120, protein: 6, fat: 6, carbs: 10 }],
    [/豚肉|肉炒め|炒め物/, { kcal: 180, protein: 14, fat: 11, carbs: 8 }],
    [/豆腐/, { kcal: 80, protein: 7, fat: 5, carbs: 2 }],
    [/ご飯|ごはん|白米|玄米|おにぎり/, { kcal: 180, protein: 3, fat: 0, carbs: 40 }],
    [/パン|トースト/, { kcal: 170, protein: 5, fat: 3, carbs: 32 }],
  ];

  for (const [pattern, nutrition] of table) {
    if (pattern.test(safe)) return nutrition;
  }

  if (/オクラ|青菜|緑の野菜|いんげん|ほうれん草|小松菜|きゅうり|キャベツ|玉ねぎ|人参/.test(safe)) {
    return { kcal: 30, protein: 1, fat: 0, carbs: 5 };
  }

  return { kcal: 120, protein: 5, fat: 4, carbs: 14 };
}

function sumNutrition(items) {
  return items.reduce((acc, item) => {
    const nutrition = estimateItemNutrition(item);
    acc.kcal += nutrition.kcal;
    acc.protein += nutrition.protein;
    acc.fat += nutrition.fat;
    acc.carbs += nutrition.carbs;
    return acc;
  }, { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}

function clampNutrition(nutrition) {
  return {
    kcal: Math.max(0, round1(nutrition.kcal || 0)),
    protein: Math.max(0, round1(nutrition.protein || 0)),
    fat: Math.max(0, round1(nutrition.fat || 0)),
    carbs: Math.max(0, round1(nutrition.carbs || 0)),
  };
}

function buildMealComment(nutrition) {
  if (nutrition.protein >= 25 && nutrition.fat <= 20) {
    return 'たんぱく質がしっかり取れていて、バランスも整えやすい内容ですね。';
  }
  if (nutrition.fat >= 25) {
    return '脂質はやや多めなので、次の食事をあっさり寄りにすると整えやすいです。';
  }
  if (nutrition.carbs >= 70) {
    return '糖質はやや多めなので、次はたんぱく質や野菜を少し足せるとバランスが良くなります。';
  }
  return '大きく崩れすぎていないので、このまま無理なく整えていけそうです。';
}

function looksLikeMealText(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  return /食べた|飲んだ|朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|ラーメン|カレー|寿司|サラダ|ご飯|ごはん|パン|ヨーグルト|おにぎり|弁当|豚肉|卵|豆腐|煮物|炒め物|和え物/.test(safe);
}

function parseMealText(text) {
  const safe = normalizeText(text);
  if (!safe || !looksLikeMealText(safe)) {
    return {
      confidence: 0.1,
      items: [],
      estimatedNutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
      comment: '',
      mealType: 'unknown',
      amountRatio: 1,
      amountNote: ''
    };
  }

  const items = splitMealItems(safe);
  const nutrition = clampNutrition(sumNutrition(items.length ? items : [safe]));
  const confidence = Math.min(0.95, 0.45 + (items.length >= 2 ? 0.25 : 0.1) + (/食べた|食べました|食べたよ|朝食|昼食|夕食|朝ごはん|昼ごはん|夜ごはん/.test(safe) ? 0.15 : 0));

  return {
    isMealImage: false,
    confidence,
    items: items.length ? items : [cleanMealText(safe)],
    estimatedNutrition: nutrition,
    estimated_nutrition: nutrition,
    comment: buildMealComment(nutrition),
    mealType: detectMealType(safe),
    amountRatio: 1,
    amountNote: '',
    recordReady: true,
  };
}

async function analyzeMealImage(imagePayload, userId = null, rawText = '') {
  try {
    const { prompt } = buildMealExtractPrompt({ rawText });
    const result = await geminiImageAnalysisService.analyzeImage(imagePayload, prompt);
    const mealData = normalizeMealData(result?.data);

    await saveMealToDb(mealData, userId);
    return mealData;
  } catch (error) {
    console.error('[meal_analysis_service] analyzeMealImage error:', error?.message || error);
    return buildFallbackMeal(error?.message || 'meal_analysis_error');
  }
}

async function buildMealImageReplyText(imagePayload, userId = null, rawText = '') {
  const mealData = await analyzeMealImage(imagePayload, userId, rawText);

  try {
    return await buildFullMealReport({
      result: {
        isMealImage: mealData.isMealImage,
        items: mealData.items,
        estimated_nutrition: mealData.estimatedNutrition,
        comment: mealData.comment,
      },
      userId,
    });
  } catch (error) {
    console.error('[meal_analysis_service] buildMealImageReplyText error:', error?.message || error);
    return [
      '📸 お食事の解析が終わりました！✨',
      `【メニュー】${(mealData.items || []).join('、')}`,
      `エネルギー: ${Math.round(mealData.estimatedNutrition?.kcal || 0)} kcal`,
      `たんぱく質: ${Math.round(mealData.estimatedNutrition?.protein || 0)} g`,
      `脂質: ${Math.round(mealData.estimatedNutrition?.fat || 0)} g`,
      `糖質: ${Math.round(mealData.estimatedNutrition?.carbs || 0)} g`,
      `💬 ${mealData.comment || '今日は仮推定でまとめました。'}`,
    ].join('\n');
  }
}

module.exports = {
  analyzeMealImage,
  buildMealImageReplyText,
  parseMealText,
};
