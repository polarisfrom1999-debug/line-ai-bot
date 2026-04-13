'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { supabase } = require('./supabase_service');

/**
 * 【完全統合版】
 * システム（orchestrator）が探し求めている「analyzeMealImage」という名前に100%合わせています。
 * これ1枚で、解析から積算、絵文字レポートまで完結するため、他のファイルとの連携エラーも起きません。
 */
async function analyzeMealImage(imagePayload, userId, rawText = '') {
  // 1. 命令書（プロンプト）の作成
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

    // 今日の合計を取得（積算機能）
    try {
      const now = new Date();
      // 日本時間の今日0時を計算
      const jstOffset = 9 * 60 * 60 * 1000;
      const todayStart = new Date(new Date(now.getTime() + jstOffset).setHours(0, 0, 0, 0) - jstOffset).toISOString();
      
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

  // 5. レポートの組み立て（ご指定の絵文字をすべて配置）
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

// 外側から見えるように、考えられるすべての名前でエクスポートします
module.exports = {
  analyzeMealImage: analyzeMealImage,
  analyzeMealImageAndCreateReport: analyzeMealImage,
  mealAnalysisService: analyzeMealImage
};
