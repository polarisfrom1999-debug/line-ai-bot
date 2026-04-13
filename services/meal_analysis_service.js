'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { buildFullMealReport } = require('./meal_report_service');
const { supabase } = require('./supabase_service');

async function analyzeMealImageAndCreateReport({ imagePayload, userId, rawText = '' }) {
  // 1. Gemini用のプロンプト（命令文）を作成
  const { prompt, schema } = buildMealExtractPrompt({ rawText });

  // 2. Geminiで画像解析を実行
  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt: prompt + "\n必ず指定のJSON形式で回答してください。"
  });

  if (!result.ok) {
    throw new Error('食事の解析に失敗しました。');
  }

  // 解析結果をJSONとして取り出し
  let mealData;
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    mealData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('JSON解析エラー:', result.text);
    throw new Error('解析データの読み取りに失敗しました。');
  }

  // 3. データベース(Supabase)に保存（積算のため）
  if (mealData.isMealImage && userId) {
    await supabase.from('meals').insert({
      user_id: userId,
      meal_label: mealData.items.join('、'),
      estimated_kcal: mealData.estimatedNutrition.kcal,
      protein_g: mealData.estimatedNutrition.protein,
      fat_g: mealData.estimatedNutrition.fat,
      carbs_g: mealData.estimatedNutrition.carbs,
      ai_comment: mealData.comment
    });
  }

  // 4. 「食事分析レポート」を組み立てる
  const finalMessage = await buildFullMealReport({
    result: mealData,
    userId: userId
  });

  return finalMessage;
}

module.exports = { analyzeMealImageAndCreateReport };
