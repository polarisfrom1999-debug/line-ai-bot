'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');

const FOOD_LIBRARY = [
  // 修正：タイミング用語(朝ごはん等)が含まれる場合は白米としてカウントしないガードを正規表現に追加
  { name: '白米', patterns: [/^(?!.*(朝|昼|晩|夜)ごはん).*白米/, /^(?!.*(朝|昼|晩|夜)ごはん).*ご飯/, /ライス/, /お米/], kcal: 234, protein: 3.8, fat: 0.5, carbs: 55.2 },
  { name: '食パン', patterns: [/食パン/, /トースト/, /パン/], kcal: 156, protein: 5.3, fat: 2.6, carbs: 28.0 },
  { name: '卵', patterns: [/卵/, /たまご/], kcal: 76, protein: 6.2, fat: 5.2, carbs: 0.2 },
  { name: '味噌汁', patterns: [/味噌汁/, /みそ汁/], kcal: 45, protein: 3.0, fat: 1.5, carbs: 4.0 },
  // ... (他のライブラリは維持)
];

function analyzeTextMeal(text) {
  const mealTypeKeywords = {
    breakfast: /朝食|朝ごはん|モーニング/,
    lunch: /昼食|昼ごはん|ランチ/,
    dinner: /夕食|晩ごはん|ディナー|夜ごはん/,
    snack: /間食|おやつ|夜食/
  };

  let detectedType = 'unknown';
  for (const [type, regex] of Object.entries(mealTypeKeywords)) {
    if (regex.test(text)) {
      detectedType = type;
      break;
    }
  }

  // 修正：解析用テキストからタイミング単語を一時的に除去して、純粋な食材だけを抽出
  const cleanTextForFood = text.replace(/朝ごはん|昼ごはん|晩ごはん|夜ごはん|夕食|朝食|昼食/g, '');
  
  const foundItems = [];
  let totalNutrition = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

  for (const food of FOOD_LIBRARY) {
    if (food.patterns.some(p => p.test(cleanTextForFood))) {
      foundItems.push(food.name);
      totalNutrition.kcal += food.kcal;
      totalNutrition.protein += food.protein;
      totalNutrition.fat += food.fat;
      totalNutrition.carbs += food.carbs;
    }
  }

  return {
    source: 'text',
    mealType: detectedType,
    items: foundItems,
    estimatedNutrition: totalNutrition,
    confidence: foundItems.length > 0 ? 0.9 : 0
  };
}

module.exports = { analyzeTextMeal, FOOD_LIBRARY };
