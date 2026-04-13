'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { buildFullMealReport } = require('./meal_report_service');
const { supabase } = require('./supabase_service');

async function analyzeMealImage(imagePayload, userId, rawText = '') {
  try {
    const { prompt } = buildMealExtractPrompt({ rawText });
    const result = await geminiImageAnalysisService.analyzeImage(imagePayload, prompt);
    const mealData = result.data;

    if (mealData.isMealImage && userId) {
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
    }

    return await buildFullMealReport({ result: mealData, userId });
  } catch (error) {
    return "申し訳ありません、画像を受け取れませんでした。もう一度お試しください。";
  }
}

module.exports = { analyzeMealImage };
