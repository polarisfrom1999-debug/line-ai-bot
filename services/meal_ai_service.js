const { generateJsonOnly } = require('./gemini_service');
const { safeText, toNumberOrNull, clamp01, round1, formatKcalRange } = require('../utils/formatters');

const MEAL_JSON_SCHEMA = {
  type: 'object',
  properties: {
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
    'meal_label',
    'food_items',
    'estimated_kcal',
    'kcal_min',
    'kcal_max',
    'confidence',
    'ai_comment',
  ],
};

const HIGH_RISK_DRINK_WORDS = [
  'ビール',
  'ハイボール',
  '酎ハイ',
  'サワー',
  'ワイン',
  '日本酒',
  '焼酎',
  '梅酒',
  'カクテル',
  'アルコール',
];

const SAFE_TEA_WORDS = [
  'ジャスミンティー',
  'お茶',
  '緑茶',
  '麦茶',
  '烏龍茶',
  'ウーロン茶',
  '紅茶',
  'ほうじ茶',
  'ルイボスティー',
  '水',
];

function normalizeMealAiResult(parsed) {
  return {
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
    ai_comment: safeText(parsed.ai_comment || '食事内容を整理しました。', 300),
  };
}

function applyDrinkSafetyRules(result) {
  if (!result || !Array.isArray(result.food_items)) return result;

  const items = result.food_items.map((item) => ({ ...item }));
  const uncertaintyNotes = [...(result.uncertainty_notes || [])];
  const confirmationQuestions = [...(result.confirmation_questions || [])];

  for (const item of items) {
    const name = String(item.name || '');

    const looksAlcohol = HIGH_RISK_DRINK_WORDS.some((w) => name.includes(w));
    const looksTea = SAFE_TEA_WORDS.some((w) => name.includes(w));

    if (looksAlcohol && !looksTea) {
      const lowConfidenceAlcohol =
        item.confidence == null || Number(item.confidence) < 0.8;

      if (lowConfidenceAlcohol) {
        item.needs_confirmation = true;
        if (item.confidence == null || item.confidence > 0.55) {
          item.confidence = 0.55;
        }

        uncertaintyNotes.push('飲み物がアルコールかお茶系かは見た目だけでは誤認しやすいため、確認前提で扱っています。');
        confirmationQuestions.push(`飲み物は「${name}」候補ですが、お茶・水・ノンアル・アルコールのどれに近いですか？`);
      }
    }
  }

  return {
    ...result,
    food_items: items,
    uncertainty_notes: uniqueStrings(uncertaintyNotes),
    confirmation_questions: uniqueStrings(confirmationQuestions),
  };
}

function buildMealAnalysisPrompt(text) {
  return [
    'あなたは日本向けの食事カロリー推定アシスタントです。',
    'ユーザーが送った食事文章を解析して、食品ごとの推定カロリーを整理してください。',
    'ただし、信用を損なう断定を避けることが最優先です。',
    '特に飲み物は誤認しやすいので、見分けに自信がない場合は alcohol と断定せず、needs_confirmation=true を使ってください。',
    'ジャスミンティー、緑茶、烏龍茶、麦茶、水などを、安易にビールや酒類と断定してはいけません。',
    '推定に自信がない項目は uncertainty_notes と confirmation_questions に確認文を入れてください。',
    '食事全体のラベル、食品一覧、概算カロリー、たんぱく質・脂質・糖質、確認事項をJSONで返してください。',
    '必ずJSONだけを返してください。',
    '',
    `食事文章: ${text}`,
  ].join('\n');
}

async function analyzeMealTextWithAI(text) {
  const prompt = buildMealAnalysisPrompt(text);
  const parsed = await generateJsonOnly(prompt, MEAL_JSON_SCHEMA, 0.2);
  const normalized = normalizeMealAiResult(parsed);
  return applyDrinkSafetyRules(normalized);
}

function buildNutritionLines(result) {
  const protein = round1(result?.protein_g);
  const fat = round1(result?.fat_g);
  const carbs = round1(result?.carbs_g);

  if (protein == null && fat == null && carbs == null) {
    return [];
  }

  return [
    '栄養の目安',
    protein != null ? `・たんぱく質: ${protein}g` : null,
    fat != null ? `・脂質: ${fat}g` : null,
    carbs != null ? `・糖質: ${carbs}g` : null,
  ].filter(Boolean);
}

function buildMealConfirmationMessage(result) {
  const lines = [
    '食事内容を整理しました。',
    `料理: ${result.meal_label || '食事'}`,
    `推定カロリー: ${formatKcalRange(result.estimated_kcal, result.kcal_min, result.kcal_max)}`,
  ];

  const nutritionLines = buildNutritionLines(result);
  if (nutritionLines.length) {
    lines.push('');
    lines.push(...nutritionLines);
  }

  const shortComment = safeText(result.ai_comment || '', 120);
  const shortUncertainty = result.uncertainty_notes?.length
    ? result.uncertainty_notes.slice(0, 2).join(' / ')
    : '';

  if (shortComment) {
    lines.push('');
    lines.push(`補足: ${shortComment}`);
  } else if (shortUncertainty) {
    lines.push('');
    lines.push(`補足: ${shortUncertainty}`);
  }

  if (result.confirmation_questions?.length) {
    lines.push('');
    lines.push(...result.confirmation_questions.map((x) => `・${x}`));
  }

  lines.push('');
  lines.push('合っていれば保存、違うところがあればそのまま訂正してください。');

  return lines.join('\n');
}

function uniqueStrings(list = []) {
  return [...new Set(list.filter(Boolean))];
}

module.exports = {
  MEAL_JSON_SCHEMA,
  analyzeMealTextWithAI,
  buildMealConfirmationMessage,
  applyDrinkSafetyRules,
};
