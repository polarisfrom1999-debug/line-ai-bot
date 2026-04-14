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
};
