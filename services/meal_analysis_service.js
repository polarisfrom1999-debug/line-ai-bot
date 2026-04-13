'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { supabase } = require('./supabase_service');

/**
 * 外部の orchestrator からは必ずこの名前で呼ばれます。
 * 名前を「analyzeMealImage」に完全固定します。
 */
async function analyzeMealImage(imagePayload, userId, rawText = '') {
  const { prompt } = buildMealExtractPrompt({ rawText });
  const result = await geminiImageAnalysisService.analyzeImage({ imagePayload, prompt });

  if (!result.ok) throw new Error('AI通信失敗');

  let mealData;
  try {
    const cleanText = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    mealData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('解析失敗');
  }

  // レポート作成
  const nut = mealData.estimated_nutrition || {};
  const lines = [
    '📸 解析完了！✨',
    '━━━━━━━━━━━━━',
    `【メニュー】: ${(mealData.items || []).join('、')}`,
    `エネルギー 🔥: ${Math.round(nut.kcal || 0)} kcal`,
    `タンパク質 💪: ${Math.round(nut.protein || 0)} g`,
    '━━━━━━━━━━━━━',
    `💬 アドバイス: ${mealData.comment || 'Good!'}`
  ];

  return lines.join('\n');
}

// 呼び出し側がどっちの名前で来ても対応できるように両方書き出します
module.exports = {
  analyzeMealImage: analyzeMealImage,
  analyzeMealImageAndCreateReport: analyzeMealImage
};
