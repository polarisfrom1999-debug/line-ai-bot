'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { buildFullMealReport } = require('./meal_report_service');
const { supabase } = require('./supabase_service');

/**
 * 食事画像解析メインプロセス
 */
async function analyzeMealImage(imagePayload, userId, rawText = '') {
  // 1. プロンプト組み立て
  const { prompt } = buildMealExtractPrompt({ rawText });

  // 2. 画像解析 (dispatch/修復機能内蔵)
  const result = await geminiImageAnalysisService.analyzeImage(imagePayload, prompt);
  const mealData = result.data;

  // 3. 既存のSupabase保存ロジック（構造維持）
  if (mealData.isMealImage && userId) {
    try {
      await supabase.from('meals').insert({
        user_id: userId,
        meal_label: (mealData.items || []).join('、'),
        estimated_kcal: mealData.estimated_nutrition?.kcal || 0,
        protein_g: mealData.estimated_nutrition?.protein || 0,
        fat_g: mealData.estimated_nutrition?.fat || 0,
        carbs_g: mealData.estimated_nutrition?.carbs || 0,
        ai_comment: mealData.comment,
        created_at: new Date().toISOString()
      });
    } catch (dbError) {
      console.error('[meal_analysis_service] Supabase Save Error:', dbError);
    }
  }

  // 4. レポート作成（日次集計を含む既存のレポートサービスへ橋渡し）
  return await buildFullMealReport({ result: mealData, userId });
}

module.exports = { analyzeMealImage };
