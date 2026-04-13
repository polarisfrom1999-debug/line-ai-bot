'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { buildFullMealReport } = require('./meal_report_service');
const { supabase } = require('./supabase_service');

/**
 * 画像を受け取り、AIで解析し、保存し、レポートを返す一連の流れ
 */
async function analyzeMealImageAndCreateReport({ imagePayload, userId, rawText = '' }) {
  // 1. 命令文を作成
  const { prompt, schema } = buildMealExtractPrompt({ rawText });

  // 2. AIで画像を解析
  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt: prompt + "\n※JSON形式で回答してください。"
  });

  if (!result.ok) throw new Error('AIの解析に失敗しました。');

  // AIの回答をプログラムで読める形に変換
  let mealData;
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    mealData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('データの読み取りに失敗しました。');
  }

  // 3. データベースへ保存（これで「積算」ができるようになります）
  if (mealData.isMealImage && userId) {
    await supabase.from('meals').insert({
      user_id: userId,
      meal_label: mealData.items.join('、'),
      estimated_kcal: mealData.estimatedNutrition.kcal,
      protein_g: mealData.estimatedNutrition.protein,
      fat_g: mealData.estimatedNutrition.fat,
      carbs_g: mealData.estimatedNutrition.carbs,
      ai_comment: mealData.comment,
      created_at: new Date().toISOString()
    });
  }

  // 4. 完成したレポートテキストを作成して返す
  return await buildFullMealReport({
    result: mealData,
    userId: userId
  });
}

module.exports = { analyzeMealImageAndCreateReport };
