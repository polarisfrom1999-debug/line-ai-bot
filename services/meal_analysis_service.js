'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { supabase } = require('./supabase_service');

/**
 * 食事解析の全プロセス（解析・保存・レポート作成）をこの1つの関数で完結させます。
 * 外側（orchestrator）が呼ぶ「analyzeMealImage」という名前に完全準拠しています。
 */
async function analyzeMealImage(imagePayload, userId, rawText = '') {
  // 1. 命令書の組み立て
  const { prompt } = buildMealExtractPrompt({ rawText });

  // 2. Geminiによる画像解析
  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt: prompt
  });

  if (!result.ok) throw new Error('AI解析に失敗しました。');

  // 3. データの抽出（JSONクリーニング）
  let mealData;
  try {
    const cleanText = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSONが見つかりません');
    mealData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('JSON解析エラー:', result.text);
    throw new Error('データの形式を読み取れませんでした。');
  }

  // 4. データベース保存と今日の積算計算
  let dailyTotalText = '';
  if (mealData.isMealImage && userId) {
    // データを保存
    await supabase.from('meals').insert({
      user_id: userId,
      meal_label: (mealData.items || []).join('、'),
      estimated_kcal: mealData.estimated_nutrition?.kcal || 0,
      protein_g: mealData.estimated_nutrition?.protein || 0,
      fat_g: mealData.estimated_nutrition?.fat || 0,
      carbs_g: mealData.estimated_nutrition?.carbs || 0,
      ai_comment: mealData.comment
    });

    // 今日の合計を取得（積算）
    try {
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
    } catch (dbErr) {
      console.error('積算エラー:', dbErr);
    }
  }

  // 5. レポートの組み立て（絵文字をすべて配置）
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

// 外側から見えるようにエクスポート。名前の不一致を完全に防ぎます。
module.exports = {
  analyzeMealImage: analyzeMealImage,
  analyzeMealImageAndCreateReport: analyzeMealImage
};
