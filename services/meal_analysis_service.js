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

function normalizeMealData(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};

  const items = Array.isArray(safe.items)
    ? safe.items.map((item) => normalizeText(item)).filter(Boolean)
    : [];

  const estimated = safe.estimated_nutrition || {};

  return {
    isMealImage: safe.isMealImage !== false,
    items: items.length ? items : ['食事画像（仮推定）'],
    estimated_nutrition: {
      kcal: normalizeNumber(estimated.kcal, 450),
      protein: normalizeNumber(estimated.protein, 20),
      fat: normalizeNumber(estimated.fat, 12),
      carbs: normalizeNumber(estimated.carbs, 50),
    },
    comment: normalizeText(safe.comment || '') || '今日は仮推定でまとめました。',
    reason: normalizeText(safe.reason || ''),
  };
}

async function saveMealAnalysis(mealData, userId) {
  if (!mealData?.isMealImage || !userId) return;

  try {
    await supabase.from('meals').insert({
      user_id: userId,
      meal_label: (mealData.items || []).join('、'),
      estimated_kcal: mealData.estimated_nutrition?.kcal || 0,
      protein_g: mealData.estimated_nutrition?.protein || 0,
      fat_g: mealData.estimated_nutrition?.fat || 0,
      carbs_g: mealData.estimated_nutrition?.carbs || 0,
      ai_comment: mealData.comment,
      created_at: new Date().toISOString(),
    });
  } catch (dbErr) {
    console.error('DB保存スキップ:', dbErr?.message || dbErr);
  }
}

async function analyzeMealImage(imagePayload, userId, rawText = '') {
  try {
    const { prompt } = buildMealExtractPrompt({ rawText });
    const result = await geminiImageAnalysisService.analyzeImage(imagePayload, prompt);
    const mealData = normalizeMealData(result?.data);

    await saveMealAnalysis(mealData, userId);

    try {
      return await buildFullMealReport({ result: mealData, userId });
    } catch (reportError) {
      console.error('食事レポート生成エラー:', reportError?.message || reportError);
      return [
        '📸 お食事の解析が終わりました！✨',
        `【メニュー】${(mealData.items || []).join('、')}`,
        `エネルギー: ${Math.round(mealData.estimated_nutrition?.kcal || 0)} kcal`,
        `たんぱく質: ${Math.round(mealData.estimated_nutrition?.protein || 0)} g`,
        `脂質: ${Math.round(mealData.estimated_nutrition?.fat || 0)} g`,
        `糖質: ${Math.round(mealData.estimated_nutrition?.carbs || 0)} g`,
        `💬 ${mealData.comment || '今日は仮推定でまとめました。'}`,
      ].join('\n');
    }
  } catch (error) {
    console.error('analyzeMealImage error:', error?.message || error);
    return '画像を読み取れませんでした。もう一度お試しください。';
  }
}

module.exports = { analyzeMealImage };
