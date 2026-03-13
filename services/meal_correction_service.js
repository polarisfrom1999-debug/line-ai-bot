const { generateJsonOnly } = require('./gemini_service');
const { safeText, toNumberOrNull, clamp01, formatKcalRange } = require('../utils/formatters');

const MEAL_CORRECTION_SCHEMA = {
  type: 'object',
  properties: {
    correction_type: { type: 'string' },
    corrected_meal_label: { type: 'string' },
    corrected_food_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          estimated_amount: { type: 'string' },
          estimated_kcal: { type: 'number' },
          category: { type: 'string' },
          confidence: { type: 'number' },
          needs_confirmation: { type: 'boolean' },
        },
        required: ['name'],
      },
    },
    corrected_estimated_kcal: { type: 'number' },
    corrected_kcal_min: { type: 'number' },
    corrected_kcal_max: { type: 'number' },
    corrected_protein_g: { type: 'number' },
    corrected_fat_g: { type: 'number' },
    corrected_carbs_g: { type: 'number' },
    confidence: { type: 'number' },
    assistant_message: { type: 'string' },
  },
  required: [
    'correction_type',
    'corrected_meal_label',
    'corrected_food_items',
    'corrected_estimated_kcal',
    'corrected_kcal_min',
    'corrected_kcal_max',
    'confidence',
    'assistant_message',
  ],
};

function normalizeFoodItem(item) {
  return {
    name: safeText(item?.name, 100),
    estimated_amount: safeText(item?.estimated_amount || item?.amount_text, 80) || null,
    estimated_kcal: toNumberOrNull(item?.estimated_kcal),
    category: safeText(item?.category, 40) || null,
    confidence: clamp01(toNumberOrNull(item?.confidence) ?? 0.7),
    needs_confirmation: !!item?.needs_confirmation,
  };
}

function normalizeCorrectedMealResult(parsed, fallbackMeal = {}) {
  return {
    meal_label: safeText(parsed.corrected_meal_label || fallbackMeal.meal_label || '食事', 100),
    food_items: Array.isArray(parsed.corrected_food_items)
      ? parsed.corrected_food_items.map((item) => normalizeFoodItem(item))
      : Array.isArray(fallbackMeal.food_items)
        ? fallbackMeal.food_items.map((item) => normalizeFoodItem(item))
        : [],
    estimated_kcal: toNumberOrNull(parsed.corrected_estimated_kcal),
    kcal_min: toNumberOrNull(parsed.corrected_kcal_min),
    kcal_max: toNumberOrNull(parsed.corrected_kcal_max),
    protein_g: toNumberOrNull(parsed.corrected_protein_g),
    fat_g: toNumberOrNull(parsed.corrected_fat_g),
    carbs_g: toNumberOrNull(parsed.corrected_carbs_g),
    confidence: clamp01(toNumberOrNull(parsed.confidence) ?? 0.7),
    ai_comment: safeText(parsed.assistant_message || '訂正内容を反映しました。', 300),
  };
}

function buildCorrectionPrompt(previousMeal, userCorrectionText) {
  const previousJson = JSON.stringify(previousMeal || {}, null, 2);

  return [
    'あなたは日本向けの食事記録訂正アシスタントです。',
    '直前の食事解析結果に対して、ユーザーが訂正を送ってきます。',
    'ユーザーの訂正を最優先し、前回の誤認を丁寧に修正してください。',
    '特に飲み物は、お茶・水・ノンアル・アルコールの取り違えに注意してください。',
    'ユーザーが「お酒ではない」「ジャスミンティー」などと訂正したら、その内容を必ず優先してください。',
    '訂正後の meal_label, food_items, kcal, PFC をJSONで返してください。',
    '必ずJSONだけを返してください。',
    '',
    '前回の解析結果:',
    previousJson,
    '',
    `今回のユーザー訂正: ${userCorrectionText}`,
  ].join('\n');
}

function getFoodItems(previousMeal) {
  return Array.isArray(previousMeal?.food_items)
    ? previousMeal.food_items.map((item) => normalizeFoodItem(item))
    : [];
}

function isDrinkItemName(name) {
  const t = String(name || '');
  return /コーヒー|カフェオレ|ラテ|ミルクティー|紅茶|お茶|茶|水|ジュース|酒|ビール|ハイボール|サワー|焼酎|ワイン|日本酒|飲み物|ドリンク/.test(t);
}

function detectDrinkCorrection(text) {
  const t = String(text || '').trim();

  if (!t) return null;

  if (/^水(です)?$/.test(t) || t.includes('水です')) {
    return {
      name: '水',
      estimated_amount: '1杯',
      estimated_kcal: 0,
      category: 'drink',
      confidence: 0.98,
      needs_confirmation: false,
    };
  }

  if (/ジャスミンティー/.test(t)) {
    return {
      name: 'ジャスミンティー',
      estimated_amount: '1杯',
      estimated_kcal: 0,
      category: 'drink',
      confidence: 0.98,
      needs_confirmation: false,
    };
  }

  if (/ウーロン茶|烏龍茶/.test(t)) {
    return {
      name: 'ウーロン茶',
      estimated_amount: '1杯',
      estimated_kcal: 0,
      category: 'drink',
      confidence: 0.98,
      needs_confirmation: false,
    };
  }

  if (/緑茶/.test(t)) {
    return {
      name: '緑茶',
      estimated_amount: '1杯',
      estimated_kcal: 0,
      category: 'drink',
      confidence: 0.98,
      needs_confirmation: false,
    };
  }

  if (/麦茶/.test(t)) {
    return {
      name: '麦茶',
      estimated_amount: '1杯',
      estimated_kcal: 0,
      category: 'drink',
      confidence: 0.98,
      needs_confirmation: false,
    };
  }

  if (/紅茶/.test(t) && !/ミルクティー/.test(t)) {
    return {
      name: '紅茶',
      estimated_amount: '1杯',
      estimated_kcal: 0,
      category: 'drink',
      confidence: 0.95,
      needs_confirmation: false,
    };
  }

  if (/無糖コーヒー|ブラックコーヒー|ブラック/.test(t)) {
    return {
      name: '無糖コーヒー',
      estimated_amount: '1杯',
      estimated_kcal: 5,
      category: 'drink',
      confidence: 0.95,
      needs_confirmation: false,
    };
  }

  if (/ミルクティー/.test(t)) {
    return {
      name: 'ミルクティー',
      estimated_amount: '1杯',
      estimated_kcal: 80,
      category: 'drink',
      confidence: 0.9,
      needs_confirmation: false,
    };
  }

  if (/カフェオレ/.test(t)) {
    return {
      name: 'カフェオレ',
      estimated_amount: '1杯',
      estimated_kcal: 80,
      category: 'drink',
      confidence: 0.9,
      needs_confirmation: false,
    };
  }

  if (/ミルク入りコーヒー/.test(t)) {
    return {
      name: 'ミルク入りコーヒー',
      estimated_amount: '1杯',
      estimated_kcal: 70,
      category: 'drink',
      confidence: 0.9,
      needs_confirmation: false,
    };
  }

  if (/お酒ではない|ノンアル|ノンアルコール/.test(t)) {
    return {
      name: 'ノンアル飲料',
      estimated_amount: '1本',
      estimated_kcal: 0,
      category: 'drink',
      confidence: 0.9,
      needs_confirmation: false,
    };
  }

  return null;
}

function replaceDrinkItem(foodItems, correctedDrink) {
  const items = Array.isArray(foodItems) ? [...foodItems] : [];
  const drinkIndex = items.findIndex((item) => isDrinkItemName(item?.name));

  if (drinkIndex >= 0) {
    items[drinkIndex] = correctedDrink;
    return items;
  }

  return [...items, correctedDrink];
}

function recalculateMealTotals(mealLike, aiComment = '訂正内容を反映しました。') {
  const foodItems = getFoodItems(mealLike);

  const estimatedKcal = foodItems.reduce((sum, item) => {
    return sum + (Number(item?.estimated_kcal) || 0);
  }, 0);

  const kcalMin = Math.max(0, Math.round(estimatedKcal * 0.85));
  const kcalMax = Math.max(kcalMin, Math.round(estimatedKcal * 1.15));

  return {
    meal_label: safeText(
      mealLike?.meal_label ||
        foodItems.map((x) => x.name).filter(Boolean).join(' / ') ||
        '食事',
      100
    ),
    food_items: foodItems,
    estimated_kcal: estimatedKcal,
    kcal_min: kcalMin,
    kcal_max: kcalMax,
    protein_g: toNumberOrNull(mealLike?.protein_g),
    fat_g: toNumberOrNull(mealLike?.fat_g),
    carbs_g: toNumberOrNull(mealLike?.carbs_g),
    confidence: clamp01(toNumberOrNull(mealLike?.confidence) ?? 0.9),
    ai_comment: safeText(aiComment, 300),
  };
}

function applyDeterministicDrinkCorrection(previousMeal, userCorrectionText) {
  const correctedDrink = detectDrinkCorrection(userCorrectionText);
  if (!correctedDrink) return null;

  const originalItems = getFoodItems(previousMeal);
  const replacedItems = replaceDrinkItem(originalItems, correctedDrink);

  const mealLabel = safeText(
    replacedItems.map((x) => x.name).filter(Boolean).join(' / ') || previousMeal?.meal_label || '食事',
    100
  );

  return recalculateMealTotals(
    {
      ...previousMeal,
      meal_label: mealLabel,
      food_items: replacedItems,
      confidence: 0.95,
    },
    `ご訂正ありがとうございます。飲み物は${correctedDrink.name}でしたね。内容を修正しました。`
  );
}

async function applyMealCorrection(previousMeal, userCorrectionText) {
  const deterministic = applyDeterministicDrinkCorrection(previousMeal, userCorrectionText);
  if (deterministic) {
    return deterministic;
  }

  const prompt = buildCorrectionPrompt(previousMeal, userCorrectionText);
  const parsed = await generateJsonOnly(prompt, MEAL_CORRECTION_SCHEMA, 0.2);
  return normalizeCorrectedMealResult(parsed, previousMeal);
}

function buildMealCorrectionConfirmationMessage(result) {
  const lines = [
    '訂正内容を反映しました。',
    `料理: ${result.meal_label || '食事'}`,
    `推定カロリー: ${formatKcalRange(result.estimated_kcal, result.kcal_min, result.kcal_max)}`,
    result.food_items?.length
      ? `内容: ${result.food_items.map((x) => x.name).filter(Boolean).join(' / ')}`
      : null,
    result.ai_comment || null,
    'これでよければ保存できます。さらに違うところがあれば続けて訂正してください。',
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  MEAL_CORRECTION_SCHEMA,
  applyMealCorrection,
  buildMealCorrectionConfirmationMessage,
};
