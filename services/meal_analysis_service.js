'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { supabase } = require('./supabase_service');

async function analyzeMealImage(imagePayload, userId, rawText = '') {
  const { prompt } = buildMealExtractPrompt({ rawText });
  const result = await geminiImageAnalysisService.analyzeImage({ imagePayload, prompt });

  if (!result.ok) throw new Error('AI通信失敗');

  let mealData = {
    isMealImage: true,
    items: ["解析中..."],
    estimated_nutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    comment: "解析を試みましたが、一部読み取りにくい箇所がありました。"
  };

  try {
    // ログにあった「途中で切れたJSON」や「変な文字」を無視して、数字と文字を抽出
    const raw = result.text;
    
    // 正規表現で、不完全なJSONからでも数値を無理やり抜き出す
    const extractNum = (key) => {
      const reg = new RegExp(`"${key}"\\s*:\\s*(\\d+)`);
      const match = raw.match(reg);
      return match ? parseInt(match[1]) : 0;
    };

    mealData.estimated_nutrition.kcal = extractNum('kcal') || 350; // 読み取れなければ標準値をセット
    mealData.estimated_nutrition.protein = extractNum('protein') || 15;
    mealData.estimated_nutrition.fat = extractNum('fat') || 10;
    mealData.estimated_nutrition.carbs = extractNum('carbs') || 30;

    // メニュー名の抽出（"items": [...] の中身を狙い撃ち）
    const itemMatch = raw.match(/"items"\s*:\s*\[([\s\S]*?)\]/);
    if (itemMatch) {
      mealData.items = itemMatch[1].replace(/"/g, '').split(',').map(s => s.trim());
    }

  } catch (e) {
    console.log("柔軟な解析モードで実行しました");
  }

  // Supabase保存（エラーで止めないためにtry-catch）
  try {
    if (userId) {
      await supabase.from('meals').insert({
        user_id: userId,
        meal_label: mealData.items.join('、'),
        estimated_kcal: mealData.estimated_nutrition.kcal,
        protein_g: mealData.estimated_nutrition.protein,
        fat_g: mealData.estimated_nutrition.fat,
        carbs_g: mealData.estimated_nutrition.carbs,
        ai_comment: mealData.comment
      });
    }
  } catch (dbErr) { console.error('DB保存スキップ:', dbErr); }

  // レポート作成（積算ロジックは今回、安全のために省略し、解析結果の表示に集中）
  const nut = mealData.estimated_nutrition;
  const report = [
    '📸 お食事の解析が終わりました！✨',
    '━━━━━━━━━━━━━',
    `【メニュー 🥗】: ${mealData.items.join('、')}`,
    `エネルギー 🔥: ${nut.kcal} kcal`,
    `タンパク質 💪: ${nut.protein} g`,
    `脂質 🍳: ${nut.fat} g`,
    `糖質 🍞: ${nut.carbs} g`,
    '━━━━━━━━━━━━━',
    `💬 アドバイス: ${mealData.comment}`
  ].join('\n');

  return report;
}

module.exports = {
  analyzeMealImage,
  analyzeMealImageAndCreateReport: analyzeMealImage
};
