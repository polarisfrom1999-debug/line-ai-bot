'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { buildFullMealReport } = require('./meal_report_service');
const { supabase } = require('./supabase_service');
const { MEAL_WORD_HINTS } = require('../config/constants');
const mealPersonalizationService = require('./meal_personalization_service');
const { parseMealAmountRatio } = require('./record_normalizer_service');

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

function normalizeMealItemLabel(item) {
  const safe = normalizeText(item);
  if (!safe) return '';

  // 曖昧な緑野菜を無理に断定しない。
  if (/[?？]|っぽい|かも|おそらく|風/.test(safe) && /オクラ|ピーマン|いんげん|青菜|小松菜|ほうれん草/.test(safe)) {
    return '緑の野菜のおかず';
  }
  if (/野菜炒めっぽい|青菜っぽい/.test(safe)) {
    return '野菜のおかず';
  }
  return safe;
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
    ? raw.items.map((item) => normalizeMealItemLabel(item)).filter(Boolean)
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
    confidence: normalizeNumber(raw.confidence, 0.7),
    raw,
  };
}

async function fetchRecentMeals(userId, limit = 30) {
  if (!normalizeText(userId)) return [];
  try {
    const { data, error } = await supabase
      .from('meals')
      .select('meal_label, estimated_kcal, protein_g, fat_g, carbs_g, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (_err) {
    return [];
  }
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

function containsQuestionTone(text) {
  return /教えて|知りたい|覚えてる|なんだっけ|ですか|ますか|かな\??|\?$|？$/.test(normalizeText(text));
}

/** 食事「記録」にすべきでない否定・嗜好・非摂取の文 */
function isMealNegationOrNonRecordText(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (/記録しない|カロリー(に)?入れない|加算しない|カウントしない/.test(safe)) return true;
  if (/食べ(て)?ない|食べません|食べなかった|食べてません|未摂取|摂取してない|摂ってない|食べなかった|食べてないよ|食べてません/.test(safe)) return true;
  if (/飲ん(で)?ない|飲みません|飲んでない/.test(safe)) return true;
  if (/抜いた|抜き|スキップ|なし(です|だよ)?$|無し/.test(safe) && /朝|昼|夜|ごはん|ご飯|食|ラーメン|ご飯/.test(safe)) return true;
  if (/嫌い|苦手|いらない|要らない|食べられない|あまり好きじゃない|好きじゃない/.test(safe)) return true;
  if (/^(いいえ|ううん|違う|ちがう)/.test(safe)) return true;
  return false;
}

function cleanMealText(text) {
  return normalizeText(text)
    .replace(/^(今日|きょう|今朝|さっき|さきほど)\s*/g, '')
    .replace(/^(朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|夕飯|晩ごはん|間食)[:：]?/g, '')
    .replace(/^(朝|昼|夜)[:：]\s*/g, '')
    .replace(/(を)?(食べた|食べました|食べたよ|食べたー|食べています|食べてる|食べたよー|飲んだ|飲みました|飲んだよ|飲んでる|でした|です)$/g, '')
    .replace(/[。！!]+$/g, '')
    .trim();
}

function splitMealItems(text) {
  const safe = cleanMealText(text);
  if (!safe) return [];

  const normalized = safe
    .replace(/[・]/g, '、')
    .replace(/[／/]/g, '、')
    .replace(/[+＋]/g, '、')
    .replace(/\s*[,&＆]\s*/g, '、')
    .replace(/\n+/g, '、')
    .replace(/、?追加で/g, '、')
    .replace(/、?あと/g, '、');

  const parts = normalized
    .split('、')
    .map((item) => normalizeMealItemLabel(item))
    .filter(Boolean);

  if (parts.length > 1) return parts;

  if (/\s/.test(safe)) {
    const spaced = safe
      .split(/\s+/)
      .map((item) => normalizeMealItemLabel(item))
      .filter(Boolean);
    if (spaced.length > 1) return spaced;
  }

  return safe
    .split(/\n+/)
    .map((item) => normalizeMealItemLabel(item))
    .filter(Boolean);
}

function estimateItemNutrition(item) {
  const safe = normalizeText(item);
  if (!safe) return { kcal: 0, protein: 0, fat: 0, carbs: 0 };

  const table = [
    [/醤油ラーメン|味噌ラーメン|豚骨ラーメン|塩ラーメン|ラーメン/, { kcal: 550, protein: 20, fat: 18, carbs: 70 }],
    [/オムライス/, { kcal: 750, protein: 20, fat: 30, carbs: 85 }],
    [/カレー/, { kcal: 650, protein: 18, fat: 20, carbs: 90 }],
    [/パスタ|スパゲティ/, { kcal: 430, protein: 14, fat: 12, carbs: 65 }],
    [/うどん/, { kcal: 320, protein: 9, fat: 4, carbs: 58 }],
    [/そば/, { kcal: 300, protein: 12, fat: 2, carbs: 55 }],
    [/ハムチーズサンド|サンド/, { kcal: 320, protein: 14, fat: 16, carbs: 30 }],
    [/弁当|定食/, { kcal: 650, protein: 24, fat: 20, carbs: 78 }],
    [/餃子/, { kcal: 220, protein: 8, fat: 10, carbs: 24 }],
    [/唐揚げ/, { kcal: 280, protein: 18, fat: 17, carbs: 12 }],
    [/焼き魚|鮭|さば|鯖|魚/, { kcal: 180, protein: 18, fat: 10, carbs: 1 }],
    [/納豆/, { kcal: 100, protein: 8, fat: 5, carbs: 6 }],
    [/味噌汁|みそ汁|スープ/, { kcal: 45, protein: 3, fat: 2, carbs: 4 }],
    [/ヨーグルト/, { kcal: 80, protein: 4, fat: 3, carbs: 10 }],
    [/ウインナー|ソーセージ/, { kcal: 140, protein: 5, fat: 12, carbs: 2 }],
    [/パイナップル|バナナ|りんご|果物|フルーツ/, { kcal: 60, protein: 0, fat: 0, carbs: 14 }],
    [/ラテ|カフェラテ/, { kcal: 140, protein: 6, fat: 5, carbs: 16 }],
    [/コーヒー|紅茶|お茶/, { kcal: 5, protein: 0, fat: 0, carbs: 1 }],
    [/ポテトサラダ/, { kcal: 180, protein: 4, fat: 11, carbs: 18 }],
    [/卵サラダ|たまごサラダ|玉子サラダ/, { kcal: 170, protein: 7, fat: 13, carbs: 6 }],
    [/サラダ/, { kcal: 90, protein: 3, fat: 6, carbs: 7 }],
    [/胡麻和え|ごま和え/, { kcal: 70, protein: 2, fat: 4, carbs: 6 }],
    [/しらたき.*炒め|しらたき/, { kcal: 40, protein: 1, fat: 1, carbs: 8 }],
    [/煮物|煮$/, { kcal: 120, protein: 6, fat: 6, carbs: 10 }],
    [/豚肉|鶏肉|牛肉|肉炒め|炒め物/, { kcal: 180, protein: 14, fat: 11, carbs: 8 }],
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
  if (isMealNegationOrNonRecordText(safe)) return false;
  if (containsQuestionTone(safe)) return false;
  if (/使い方|送り方|メニュー|コマンド|設定|タイプ変更|雰囲気変更/.test(safe)) return false;
  if (/運動|歩いた|ジョギング|ランニング|ウォーキング|スクワット|腕立て|体重|体脂肪|睡眠|便通/.test(safe) && !/食べた|飲んだ/.test(safe)) return false;
  if (/^(朝|昼|夜|夕)(ごはん|ご飯|食)(です|でした)?$/.test(safe)) return false;
  if (/^(ごはん|ご飯)(です|でした)?$/.test(safe)) return false;
  if (/(食べた|食べました|食べたよ|食べてる|飲んだ|飲みました|飲んだよ|飲んでる|朝食|昼食|夕食|朝ごはん|昼ごはん|夜ごはん|間食)/.test(safe)) return true;
  if (MEAL_WORD_HINTS.some((word) => safe.includes(word))) return true;
  return /ラーメン|カレー|寿司|サラダ|ご飯|ごはん|パン|ヨーグルト|おにぎり|弁当|豚肉|卵|豆腐|煮物|炒め物|和え物|味噌汁|みそ汁|餃子|パスタ|うどん|そば|ラテ|コーヒー|バナナ|納豆/.test(safe);
}

function parseMealText(text) {
  const safe = normalizeText(text);
  if (!safe || isMealNegationOrNonRecordText(safe)) {
    return {
      confidence: 0.05,
      items: [],
      estimatedNutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
      comment: '',
      mealType: 'unknown',
      amountRatio: 1,
      amountNote: '',
      recordReady: false,
    };
  }
  if (!looksLikeMealText(safe)) {
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

  const cleaned = cleanMealText(safe);
  const items = splitMealItems(cleaned).slice(0, 8);
  const ratioInfo = parseMealAmountRatio(safe);
  const baseNutrition = clampNutrition(sumNutrition(items.length ? items : [cleaned || safe]));
  const nutrition = clampNutrition({
    kcal: baseNutrition.kcal * (ratioInfo.ratio || 1),
    protein: baseNutrition.protein * (ratioInfo.ratio || 1),
    fat: baseNutrition.fat * (ratioInfo.ratio || 1),
    carbs: baseNutrition.carbs * (ratioInfo.ratio || 1)
  });
  const confidence = Math.min(
    0.95,
    0.4
      + (items.length >= 2 ? 0.22 : 0.1)
      + (/(食べた|食べました|食べたよ|飲んだ|飲みました|朝食|昼食|夕食|朝ごはん|昼ごはん|夜ごはん|間食)/.test(safe) ? 0.18 : 0)
      + (MEAL_WORD_HINTS.some((word) => safe.includes(word)) ? 0.12 : 0)
  );

  return {
    isMealImage: false,
    confidence,
    items: items.length ? items : [cleaned || safe],
    estimatedNutrition: nutrition,
    estimated_nutrition: nutrition,
    comment: buildMealComment(nutrition),
    mealType: detectMealType(safe),
    amountRatio: 1,
    amountRatio: ratioInfo.ratio || 1,
    amountNote: ratioInfo.note || '',
    recordReady: true,
  };
}

async function analyzeMealImage(imagePayload, userId = null, rawText = '') {
  try {
    const { prompt } = buildMealExtractPrompt({ rawText });
    const result = await geminiImageAnalysisService.analyzeImage(imagePayload, prompt);
    const mealData = normalizeMealData(result?.data);
    const recentMeals = await fetchRecentMeals(userId, 40);
    const personalized = mealPersonalizationService.applyPersonalization({
      mealLabel: (mealData.items || [])[0] || '',
      nutrition: mealData.estimatedNutrition,
      recentMeals,
      textProvided: Boolean(normalizeText(rawText))
    });
    const patterns = mealPersonalizationService.analyzeMealPatterns(recentMeals);
    const feedback = mealPersonalizationService.buildSingleFeedback({
      nutrition: personalized.adjusted,
      patterns,
      mismatch: { level: 'unknown' }
    });

    mealData.estimatedNutrition = personalized.adjusted;
    mealData.estimated_nutrition = personalized.adjusted;
    mealData.confidence = personalized.confidence;
    if (feedback) mealData.comment = feedback;

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
  isMealNegationOrNonRecordText,
};
