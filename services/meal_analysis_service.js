'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { buildFullMealReport } = require('./meal_report_service');
const { supabase } = require('./supabase_service');

/**
 * 画像を解析してレポートを作成するメイン関数
 * 外側のシステム（conversation_orchestrator）からこの名前（analyzeMealImage）で
 * 呼ばれているため、その名前に合わせています。
 */
async function analyzeMealImage(imagePayload, userId, rawText = '') {
  // 1. Geminiに送る命令（プロンプト）を作成
  const { prompt } = buildMealExtractPrompt({ rawText });

  // 2. Geminiに画像を送信し、解析結果（JSON）を取得
  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt: prompt + "\n必ずJSON形式で回答してください。"
  });

  if (!result.ok) {
    throw new Error('Geminiの通信に失敗しました。');
  }

  // 3. Geminiの回答からJSONデータを抜き取る
  let mealData;
  try {
    // ログに出ていた```jsonのような不要な文字を除去
    const cleanText = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error('JSONデータが見つかりません');
    }
    
    mealData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('JSON解析エラー（生データ）:', result.text);
    throw new Error('データの読み取りに失敗しました。もう一度お試しください。');
  }

  // 4. Supabaseに保存（これで積算機能が動きます）
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

  // 5. LINEに送るメッセージを組み立てる（meal_report_serviceを呼び出す）
  return await buildFullMealReport({ result: mealData, userId });
}

module.exports = { analyzeMealImage };
