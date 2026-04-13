'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { supabase } = require('./supabase_service');

/**
 * 外部（orchestrator）からは必ず「analyzeMealImage」という名前で呼ばれます。
 * この1ファイルで解析・保存・レポート・積算のすべてを完結させます。
 */
async function analyzeMealImage(imagePayload, userId, rawText = '') {
  // 1. Geminiへの命令書（プロンプト）を作成
  const { prompt } = buildMealExtractPrompt({ rawText });

  // 2. Geminiによる画像解析を実行
  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt: prompt
  });

  if (!result.ok) throw new Error('AIとの通信に失敗しました。');

  // 3. 【最重要】データの抽出（AIの回答から {} の中身だけを確実に抜き出す）
  let mealData;
  try {
    const rawText = result.text;
    const startIdx = rawText.indexOf('{');
    const endIdx = rawText.lastIndexOf('}');
    
    if (startIdx === -1 || endIdx === -1) {
      console.error('JSONが見つかりません。生データ:', rawText);
      throw new Error('解析データの形式が正しくありません。');
    }
    
    // 命令に従わず座標データなどを返してきた場合でも、ここできちんと抽出します
    const jsonString = rawText.substring(startIdx, endIdx + 1);
    mealData = JSON.parse(jsonString);
  } catch (e) {
    console.error('解析失敗の生データ:', result.text);
    throw new Error('データの読み取りに失敗しました。もう一度お試しください。');
  }

  // 4. データベース(Supabase)への保存と積算の準備
  let dailyTotalText = '';
  if (mealData.isMealImage && userId) {
    // 解析結果を保存
    await supabase.from('meals').insert({
      user_id: userId,
      meal_label: (mealData.items || []).join('、'),
      estimated_kcal: mealData.estimated_nutrition?.kcal || 0,
      protein_g: mealData.estimated_nutrition?.protein || 0,
      fat_g: mealData.estimated_nutrition?.fat || 0,
      carbs_g: mealData.estimated_nutrition?.carbs || 0,
      ai_comment: mealData.comment
    });

    // 今日の合計（積算）を計算
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
      console.error('積算取得エラー:', dbErr);
    }
  }

  // 5. レポートの組み立て（ご希望の絵文字をすべて反映）
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

// 外部からの呼び出し名（両方）に対応
module.exports = {
  analyzeMealImage: analyzeMealImage,
  analyzeMealImageAndCreateReport: analyzeMealImage
};
