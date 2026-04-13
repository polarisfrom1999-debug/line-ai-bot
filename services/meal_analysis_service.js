'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { buildFullMealReport } = require('./meal_report_service');
const { supabase } = require('./supabase_service');

/**
 * 画像を解析してレポートを作成するメイン関数
 */
async function analyzeMealImage(imagePayload, userId, rawText = '') {
  // 1. プロンプト（命令書）の取得
  const { prompt } = buildMealExtractPrompt({ rawText });

  // 2. Geminiで画像解析
  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt: prompt
  });

  if (!result.ok) {
    throw new Error('Geminiとの通信に失敗しました。');
  }

  // 3. 解析結果（JSON）の抽出とクリーニング
  let mealData;
  try {
    // ログに出ていた「```json」などの不要な飾りを除去
    const cleanText = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      console.error('JSONが見つかりません。生データ:', result.text);
      throw new Error('データの形式が正しくありません。');
    }
    
    mealData = JSON.parse(jsonMatch[0]);

    // AIが「座標リスト（配列）」を返してきた場合の最終チェック
    if (Array.isArray(mealData)) {
      throw new Error('AIが栄養素ではなくリストを返しました。もう一度お試しください。');
    }
  } catch (e) {
    console.error('解析エラー詳細:', e.message);
    throw new Error('データの読み取りに失敗しました。もう一度写真を送ってみてください。');
  }

  // 4. Supabase（データベース）に保存
  if (mealData.isMealImage && userId) {
    try {
      await supabase.from('meals').insert({
        user_id: userId,
        meal_label: (mealData.items || []).join('、'),
        estimated_kcal: mealData.estimated_nutrition?.kcal || 0,
        protein_g: mealData.estimated_nutrition?.protein || 0,
        fat_g: mealData.estimated_nutrition?.fat || 0,
        carbs_g: mealData.estimated_nutrition?.carbs || 0,
        ai_comment: mealData.comment
      });
    } catch (dbError) {
      console.error('データベース保存失敗:', dbError);
      // 保存失敗してもレポート表示だけは進める
    }
  }

  // 5. LINE用のレポート作成（meal_report_serviceを呼び出す）
  return await buildFullMealReport({ result: mealData, userId });
}

module.exports = { 
  analyzeMealImage,
  analyzeMealImageAndCreateReport: analyzeMealImage 
};
