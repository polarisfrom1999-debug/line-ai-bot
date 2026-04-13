'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { buildFullMealReport } = require('./meal_report_service');
const { supabase } = require('./supabase_service');

async function analyzeMealImage(imagePayload, userId, rawText = '') {
  // 1. プロンプト作成
  const { prompt } = buildMealExtractPrompt({ rawText });

  // 2. AI画像解析
  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt: prompt + "\n必ずJSON形式で回答してください。"
  });

  if (!result.ok) throw new Error('Geminiの通信に失敗しました。');

  // 3. JSON抽出
  let mealData;
  try {
    const cleanText = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON形式が見つかりません');
    mealData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('JSON解析エラー:', result.text);
    throw new Error('データの読み取りに失敗しました。');
  }

  // 4. Supabaseに保存（積算用）
  if (mealData.isMealImage && userId) {
    await supabase.from('meals').insert({
      user_id: userId,
      meal_label: (mealData.items || []).join('、'),
      estimated_kcal: mealData.estimated_nutrition?.kcal || 0,
      protein_g: mealData.estimated_nutrition?.protein || 0,
      fat_g: mealData.estimated_nutrition?.fat || 0,
      carbs_g: mealData.estimated_nutrition?.carbs || 0,
      ai_comment: mealData.comment
    });
  }

  // 5. レポート作成
  return await buildFullMealReport({ result: mealData, userId });
}

module.exports = { 
  analyzeMealImage,
  analyzeMealImageAndCreateReport: analyzeMealImage 
};
