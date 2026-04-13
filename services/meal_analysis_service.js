'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { buildFullMealReport } = require('./meal_report_service');
const { supabase } = require('./supabase_service');

/**
 * 画像を解析してレポートを作成するメイン関数
 * 外側のプログラムから「analyzeMealImage」という名前で呼ばれているため、その名前に合わせています
 */
async function analyzeMealImage(imagePayload, userId, rawText = '') {
  // 1. Gemini用のプロンプトを作成
  const { prompt } = buildMealExtractPrompt({ rawText });

  // 2. Geminiで画像解析を実行
  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt: prompt + "\n必ずJSON形式で回答してください。"
  });

  if (!result.ok) {
    throw new Error('食事の解析に失敗しました。');
  }

  // 3. 解析結果（JSON）を読み取り
  let mealData;
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    mealData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('JSON解析エラー:', result.text);
    throw new Error('解析データの読み取りに失敗しました。');
  }

  // 4. Supabase（データベース）に保存（積算機能のため）
  if (mealData.isMealImage && userId) {
    await supabase.from('meals').insert({
      user_id: userId,
      meal_label: mealData.items.join('、'),
      estimated_kcal: mealData.estimated_nutrition?.kcal || 0,
      protein_g: mealData.estimated_nutrition?.protein || 0,
      fat_g: mealData.estimated_nutrition?.fat || 0,
      carbs_g: mealData.estimated_nutrition?.carbs || 0,
      ai_comment: mealData.comment
    });
  }

  // 5. LINE用のレポート（絵文字たっぷり）を組み立てて返却
  return await buildFullMealReport({ result: mealData, userId });
}

// どちらの名前で呼ばれても動くようにエクスポートします
module.exports = { 
  analyzeMealImage,
  analyzeMealImageAndCreateReport: analyzeMealImage 
};
