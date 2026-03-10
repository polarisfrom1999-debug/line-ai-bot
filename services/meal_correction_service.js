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

function normalizeCorrectedMealResult(parsed, fallbackMeal = {}) {
  return {
    meal_label: safeText(parsed.corrected_meal_label || fallbackMeal.meal_label || '食事', 100),
    food_items: Array.isArray(parsed.corrected_food_items)
      ? parsed.corrected_food_items.map((item) => ({
          name: safeText(item.name, 100),
          estimated_amount: safeText(item.estimated_amount, 80) || null,
          estimated_kcal: toNumberOrNull(item.estimated_kcal),
          category: safeText(item.category, 40) || null,
          confidence: clamp01(toNumberOrNull(item.confidence)),
          needs_confirmation: !!item.needs_confirmation,
        }))
      : Array.isArray(fallbackMeal.food_items)
        ? fallbackMeal.food_items
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

async function applyMealCorrection(previousMeal, userCorrectionText) {
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