'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { supabase } = require('./supabase_service');

/**
 * 【決定版】
 * 外側のorchestratorが「analyzeMealImage」という名前で呼び出すため、
 * 関数名とエクスポート名を完全にその名前に統一しました。
 */
async function analyzeMealImage(imagePayload, userId, rawText = '') {
  // 1. プロンプト作成
  const { prompt } = buildMealExtractPrompt({ rawText });

  // 2. Geminiで画像解析
  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt: prompt
  });

  if (!result.ok) throw new Error('Gemini通信失敗');

  // 3. 解析データの読み取り（JSON抽出）
  let mealData;
  try {
    const cleanText = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSONなし');
    mealData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('解析エラー:', result.text);
    throw new Error('解析データの読み取りに失敗しました。');
  }

  // 4. Supabaseへの保存と「今日の合計」計算
  let dailyTotalText = '';
  if (mealData.isMealImage && userId) {
    // 保存
    await supabase.from('meals').insert({
      user_id: userId,
      meal_label: (mealData.items || []).join('、'),
      estimated_kcal: mealData.estimated_nutrition?.kcal || 0,
      protein_g: mealData.estimated_nutrition?.protein || 0,
      fat_g: mealData.estimated_nutrition?.fat || 0,
      carbs_g: mealData.estimated_nutrition?.carbs || 0,
      ai_comment: mealData.comment
    });

    // 今日の合計を取得
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const { data } = await supabase
      .from('meals')
      .select('estimated_kcal, protein_g, fat_g, carbs_g')
      .eq('user_id', userId)
      .gte('created_at', todayStart);

    if (data && data.length > 0) {
      const total = data.reduce((acc, cur) => ({
        kcal: acc.kcal + (Number(cur.estimated_kcal) || 0),
        protein: acc.protein + (Number(cur.protein_g) || 0),
        fat: acc.fat + (Number(cur.fat_g) || 0),
        carbs: acc.carbs + (Number(cur.carbs_g) || 0)
      }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });

      dailyTotalText = `
📈 本日の合計（積算）
┈┈┈┈┈┈┈┈┈┈┈┈┈
  エネルギー 🔥: ${Math.round(total.kcal)} kcal
  タンパク質 💪: ${Math.round(total.protein)} g
  脂質 🍳: ${Math.round(total.fat)} g
  糖質 🍞: ${Math.round(total.carbs)} g
━━━━━━━━━━━━━`;
    }
  }

  // 5. レポートの組み立て（絵文字入り）
  const nut = mealData.estimated_nutrition || {};
  const report = [
    '📸 お食事の解析が終わりました！✨',
    '━━━━━━━━━━━━━',
    `【メニュー 🥗】: ${(mealData.items || []).join('、')}`,
    `エネルギー 🔥: ${Math.round(nut.kcal || 0)} kcal`,
    `タンパク質 💪: ${Math.round(nut.protein || 0)} g`,
    `脂質 🍳: ${Math.round(nut.fat || 0)} g`,
    `糖質 🍞: ${Math.round(nut.carbs || 0)} g`,
    '━━━━━━━━━━━━━',
    `💬 牛込先生のアドバイス:\n「${mealData.comment || '今日も一歩、健康に近づきましたね。'}」`,
    dailyTotalText
  ].filter(Boolean).join('\n');

  return report;
}

// 呼び出し側の期待に100%応えるためのエクスポート設定
module.exports = {
  analyzeMealImage: analyzeMealImage,
  analyzeMealImageAndCreateReport: analyzeMealImage
};
