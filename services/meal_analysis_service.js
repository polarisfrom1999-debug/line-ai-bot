'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { supabase } = require('./supabase_service');

/**
 * 画像を解析してレポートを作成するメイン関数
 * 名前を元々の「analyzeMealImage」に固定し、エラーを確実に消します
 */
async function analyzeMealImage(imagePayload, userId, rawText = '') {
  // 1. 命令書の作成
  const { prompt } = buildMealExtractPrompt({ rawText });

  // 2. AIによる画像解析
  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt: prompt
  });

  if (!result.ok) throw new Error('通信失敗');

  // 3. データの読み取り
  let mealData;
  try {
    const cleanText = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    mealData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('解析エラー:', result.text);
    throw new Error('解析データの読み取りに失敗しました。');
  }

  // 4. データベース(Supabase)への保存
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

  // 5. レポート作成（ここに絵文字と積算機能を直接書きました）
  const lines = [];
  if (mealData.isMealImage) {
    lines.push('📸 お食事の解析が終わりました！✨');
    lines.push('━━━━━━━━━━━━━');
    lines.push(`【メニュー 🥗】: ${(mealData.items || []).join('、')}`);
    
    const nut = mealData.estimated_nutrition || {};
    lines.push(`エネルギー 🔥: ${Math.round(nut.kcal || 0)} kcal`);
    lines.push(`タンパク質 💪: ${Math.round(nut.protein || 0)} g`);
    lines.push(`脂質 🍳: ${Math.round(nut.fat || 0)} g`);
    lines.push(`糖質 🍞: ${Math.round(nut.carbs || 0)} g`);
    lines.push('━━━━━━━━━━━━━');
    lines.push(`💬 牛込先生のアドバイス:\n「${mealData.comment || '今日も一歩、健康に近づきましたね。'}」`);
    lines.push('');

    // 今日の合計（積算）を取得
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

      lines.push('📈 本日の合計（積算）');
      lines.push('┈┈┈┈┈┈┈┈┈┈┈┈┈');
      lines.push(`  エネルギー 🔥: ${Math.round(total.kcal)} kcal`);
      lines.push(`  タンパク質 💪: ${Math.round(total.protein)} g`);
      lines.push(`  脂質 🍳: ${Math.round(total.fat)} g`);
      lines.push(`  糖質 🍞: ${Math.round(total.carbs)} g`);
      lines.push('━━━━━━━━━━━━━');
    }
  } else {
    lines.push('食事の画像ではないようです。😊');
  }

  return lines.join('\n');
}

module.exports = { analyzeMealImage };
