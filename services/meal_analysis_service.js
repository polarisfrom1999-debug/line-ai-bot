'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { buildFullMealReport } = require('./meal_report_service');
const { supabase } = require('./supabase_service');

/**
 * 画像を解析してレポートを作成するメイン関数
 */
async function analyzeMealImageAndCreateReport({ imagePayload, userId, rawText = '' }) {
  const { prompt } = buildMealExtractPrompt({ rawText });

  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt: prompt + "\n必ずJSON形式で回答してください。"
  });

  if (!result.ok) throw new Error('解析に失敗しました。');

  // Geminiの回答からJSON部分を抽出
  let mealData;
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    mealData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('データの読み取りに失敗しました。');
  }

  // Supabaseに保存（これで「積算」ができるようになります）
  if (mealData.isMealImage && userId) {
    await supabase.from('meals').insert({
      user_id: userId,
      meal_label: mealData.items.join('、'),
      estimated_kcal: mealData.estimated_nutrition.kcal,
      protein_g: mealData.estimated_nutrition.protein,
      fat_g: mealData.estimated_nutrition.fat,
      carbs_g: mealData.estimated_nutrition.carbs,
      ai_comment: mealData.comment
    });
  }

  // レポート作成
  return await buildFullMealReport({ result: mealData, userId });
}

module.exports = { analyzeMealImageAndCreateReport };
