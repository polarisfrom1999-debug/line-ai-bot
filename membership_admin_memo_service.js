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
    is_meal: !!parsed?.is_meal,
    meal_label: safeText(parsed?.meal_label || '食事', 100),
    food_items: Array.isArray(parsed?.food_items)
      ? parsed.food_items
          .map((item) => ({
            name: safeText(item?.name, 100),
            estimated_amount: safeText(item?.estimated_amount, 80) || null,
            estimated_kcal: toNumberOrNull(item?.estimated_kcal),
            category: safeText(item?.category, 40) || null,
            confidence: clamp01(toNumberOrNull(item?.confidence)),
            needs_confirmation: !!item?.needs_confirmation,
          }))
          .filter((item) => item.name)
      : [],
    estimated_kcal: toNumberOrNull(parsed?.estimated_kcal),
    kcal_min: toNumberOrNull(parsed?.kcal_min),
    kcal_max: toNumberOrNull(parsed?.kcal_max),
    protein_g: toNumberOrNull(parsed?.protein_g),
    fat_g: toNumberOrNull(parsed?.fat_g),
    carbs_g: toNumberOrNull(parsed?.carbs_g),
    confidence: clamp01(toNumberOrNull(parsed?.confidence) ?? 0.5),
    uncertainty_notes: Array.isArray(parsed?.uncertainty_notes)
      ? parsed.uncertainty_notes.map((x) => safeText(x, 120)).filter(Boolean)
      : [],
    confirmation_questions: Array.isArray(parsed?.confirmation_questions)
      ? parsed.confirmation_questions.map((x) => safeText(x, 120)).filter(Boolean)
      : [],
    ai_comment: safeText(parsed?.ai_comment || '食事写真を整理しました。', 300),
  };
}

function buildMealImagePrompt() {
  return [
    'あなたは日本向けの食事・飲み物写真解析アシスタントです。',
    'この判定では、食べ物だけでなく飲み物単体の写真も記録対象です。',
    '画像が食事または飲み物の写真なら is_meal=true にしてください。',
    '食事でも飲み物でもない画像、または判別が難しい場合のみ is_meal=false にしてください。',
    '食事については、一般名に丸めすぎず、料理名・商品名・魚種・貝の種類など具体名が有力なら具体名を優先してください。',
    '例: サーモン刺身、ホンビノス貝、プレミアムチョコクロ、フレンチトースト。',
    '特に市販飲料のペットボトル、缶、紙パック、コップ飲料は、ラベルや見た目から商品名・飲料名をできるだけ拾ってください。',
    'ラベルが読める場合は商品名を優先してください。メーカー名が分かれば item 名や meal_label に反映して構いません。',
    '飲み物は food_items に必ず1件以上入れてください。',
    '1本、1缶、1杯、コップ1杯など、量の見当がつく場合は estimated_amount に入れてください。',
    'カロリーは高め安全側に寄せすぎず、見た目に対して現実的な中央値寄りで estimated_kcal を入れてください。',
    '刺身や貝類は高くしすぎないでください。サーモン刺身は1切れ25〜35kcal、大ぶりの貝は1個20〜35kcalを目安にしてください。',
    'ただし、アルコールかお茶か曖昧な場合は断定せず needs_confirmation=true にしてください。',
    'ジャスミンティー、緑茶、烏龍茶、麦茶、水を安易にビールや酒類と断定してはいけません。',
    '信用を損なう断定を避けることが最優先です。',
    '自信が低い項目は uncertainty_notes と confirmation_questions に確認文を入れてください。',
    '必ずJSONだけを返してください。',
  ].join('\n');
}

function repairDrinkOnlyResult(result) {
  const normalized = normalizeMealImageResult(result);

  const drinkLike =
    /茶|ティー|コーヒー|珈琲|レモネード|ジュース|水|ウォーター|スポーツドリンク|サイダー|ソーダ|プロテイン|飲料|ドリンク/i
      .test(normalized.meal_label || '') ||
    normalized.food_items.some((item) =>
      /茶|ティー|コーヒー|珈琲|レモネード|ジュース|水|ウォーター|スポーツドリンク|サイダー|ソーダ|プロテイン|飲料|ドリンク/i
        .test(item.name || '')
    );

  if (!normalized.is_meal && drinkLike) {
    normalized.is_meal = true;
  }

  if (normalized.is_meal && !normalized.food_items.length && normalized.meal_label) {
    normalized.food_items = [
      {
        name: safeText(normalized.meal_label, 100),
        estimated_amount: '1本',
        estimated_kcal: normalized.estimated_kcal,
        category: 'drink',
        confidence: normalized.confidence,
        needs_confirmation: normalized.confidence < 0.75,
      },
    ];
  }

  if (normalized.is_meal && !normalized.meal_label && normalized.food_items.length) {
    normalized.meal_label = safeText(normalized.food_items[0].name || '飲み物', 100);
  }

  return normalized;
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
          temperature: 0.12,
        },
      }), 2, 700);

      const parsed = safeJsonParse(extractGeminiText(response), {});
      const repaired = repairDrinkOnlyResult(parsed);

      if (!repaired.is_meal) {
        return repaired;
      }

      return applyDrinkSafetyRules(repaired);
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
