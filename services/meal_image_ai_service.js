const {
  genAI,
  extractGeminiText,
  safeJsonParse,
  retry,
} = require('./gemini_service');
const { getEnv } = require('../config/env');
const {
  safeText,
  toNumberOrNull,
  clamp01,
} = require('../utils/formatters');
const { applyDrinkSafetyRules } = require('./meal_ai_service');

const env = getEnv();

const MEAL_IMAGE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    is_meal: { type: 'boolean' },
    meal_label: { type: 'string' },
    food_items: {
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
    estimated_kcal: { type: 'number' },
    kcal_min: { type: 'number' },
    kcal_max: { type: 'number' },
    protein_g: { type: 'number' },
    fat_g: { type: 'number' },
    carbs_g: { type: 'number' },
    confidence: { type: 'number' },
    uncertainty_notes: {
      type: 'array',
      items: { type: 'string' },
    },
    confirmation_questions: {
      type: 'array',
      items: { type: 'string' },
    },
    ai_comment: { type: 'string' },
  },
  required: [
    'is_meal',
    'meal_label',
    'food_items',
    'estimated_kcal',
    'kcal_min',
    'kcal_max',
    'confidence',
    'ai_comment',
  ],
};

function normalizeMealImageResult(parsed) {
  return {
    is_meal: !!parsed.is_meal,
    meal_label: safeText(parsed.meal_label || '食事', 100),
    food_items: Array.isArray(parsed.food_items)
      ? parsed.food_items.map((item) => ({
          name: safeText(item.name, 100),
          estimated_amount: safeText(item.estimated_amount, 80) || null,
          estimated_kcal: toNumberOrNull(item.estimated_kcal),
          category: safeText(item.category, 40) || null,
          confidence: clamp01(toNumberOrNull(item.confidence)),
          needs_confirmation: !!item.needs_confirmation,
        }))
      : [],
    estimated_kcal: toNumberOrNull(parsed.estimated_kcal),
    kcal_min: toNumberOrNull(parsed.kcal_min),
    kcal_max: toNumberOrNull(parsed.kcal_max),
    protein_g: toNumberOrNull(parsed.protein_g),
    fat_g: toNumberOrNull(parsed.fat_g),
    carbs_g: toNumberOrNull(parsed.carbs_g),
    confidence: clamp01(toNumberOrNull(parsed.confidence) ?? 0.5),
    uncertainty_notes: Array.isArray(parsed.uncertainty_notes)
      ? parsed.uncertainty_notes.map((x) => safeText(x, 120)).filter(Boolean)
      : [],
    confirmation_questions: Array.isArray(parsed.confirmation_questions)
      ? parsed.confirmation_questions.map((x) => safeText(x, 120)).filter(Boolean)
      : [],
    ai_comment: safeText(parsed.ai_comment || '食事写真を整理しました。', 300),
  };
}

function buildMealImagePrompt() {
  return [
    'あなたは日本向けの食事写真解析アシスタントです。',
    '画像が食事写真かどうかをまず判定してください。',
    '食事ではない、または判別が難しい場合は is_meal=false にしてください。',
    '食事写真なら、料理名・食品一覧・概算カロリー・PFCを整理してください。',
    '信用を損なう断定を避けることが最優先です。',
    '特に飲み物は誤認しやすいので、アルコールかお茶か曖昧なら断定せず needs_confirmation=true を使ってください。',
    'ジャスミンティー、緑茶、烏龍茶、麦茶、水を、安易にビールや酒類と断定してはいけません。',
    '自信が低い項目は uncertainty_notes と confirmation_questions に確認文を入れてください。',
    '必ずJSONだけを返してください。',
  ].join('\n');
}

async function analyzeMealImageWithAI(buffer, mimeType) {
  const imagePart = {
    inlineData: {
      mimeType,
      data: buffer.toString('base64'),
    },
  };

  const prompt = buildMealImagePrompt();
  const tryModels = [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL];
  let lastError;

  for (const model of tryModels) {
    try {
      const response = await retry(async () => genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }, imagePart] }],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: MEAL_IMAGE_JSON_SCHEMA,
          temperature: 0.2,
        },
      }), 2, 700);

      const parsed = safeJsonParse(extractGeminiText(response));
      const normalized = normalizeMealImageResult(parsed);

      if (!normalized.is_meal) {
        return normalized;
      }

      return applyDrinkSafetyRules(normalized);
    } catch (error) {
      lastError = error;
      console.error(`⚠️ analyzeMealImageWithAI failed on ${model}:`, error?.message || error);
    }
  }

  throw lastError || new Error('Meal image analysis failed');
}

module.exports = {
  MEAL_IMAGE_JSON_SCHEMA,
  analyzeMealImageWithAI,
};