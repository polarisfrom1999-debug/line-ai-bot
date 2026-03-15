const { generateJsonOnly } = require('./gemini_service');
const {
  safeText,
  toNumberOrNull,
  clamp01,
  formatKcalRange,
} = require('../utils/formatters');

const MEAL_CORRECTION_SCHEMA = {
  type: 'object',
  properties: {
    overwrite_all: { type: 'boolean' },
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
    uncertainty_notes: {
      type: 'array',
      items: { type: 'string' },
    },
    confirmation_questions: {
      type: 'array',
      items: { type: 'string' },
    },
    correction_summary: { type: 'string' },
  },
  required: [
    'overwrite_all',
    'correction_type',
    'corrected_meal_label',
    'corrected_food_items',
    'corrected_estimated_kcal',
    'corrected_kcal_min',
    'corrected_kcal_max',
    'correction_summary',
  ],
};

function uniqueStrings(list = []) {
  return [...new Set((list || []).map((x) => safeText(x, 160)).filter(Boolean))];
}

function normalizeFoodItem(item) {
  return {
    name: safeText(item?.name, 100) || '不明な食品',
    estimated_amount: safeText(item?.estimated_amount, 80) || null,
    estimated_kcal: Math.max(0, toNumberOrNull(item?.estimated_kcal) ?? 0),
    category: safeText(item?.category, 40) || null,
    confidence: clamp01(toNumberOrNull(item?.confidence) ?? 0.85),
    needs_confirmation: !!item?.needs_confirmation,
  };
}

function normalizeMeal(meal) {
  return {
    meal_label: safeText(meal?.meal_label || '食事', 100),
    food_items: Array.isArray(meal?.food_items)
      ? meal.food_items.map(normalizeFoodItem).filter((x) => x.name)
      : [],
    estimated_kcal: Math.max(0, toNumberOrNull(meal?.estimated_kcal) ?? 0),
    kcal_min: Math.max(0, toNumberOrNull(meal?.kcal_min) ?? 0),
    kcal_max: Math.max(0, toNumberOrNull(meal?.kcal_max) ?? 0),
    protein_g: toNumberOrNull(meal?.protein_g),
    fat_g: toNumberOrNull(meal?.fat_g),
    carbs_g: toNumberOrNull(meal?.carbs_g),
    confidence: clamp01(toNumberOrNull(meal?.confidence) ?? 0.85),
    ai_comment: safeText(meal?.ai_comment || '内容を整理しました。', 1000),
    uncertainty_notes: Array.isArray(meal?.uncertainty_notes)
      ? meal.uncertainty_notes.map((x) => safeText(x, 160)).filter(Boolean)
      : [],
    confirmation_questions: Array.isArray(meal?.confirmation_questions)
      ? meal.confirmation_questions.map((x) => safeText(x, 160)).filter(Boolean)
      : [],
    raw_model_json: meal?.raw_model_json || meal || {},
  };
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[ 　\t\r\n]+/g, '')
    .replace(/[。、,.!！?？:：;；"'“”‘’（）()\[\]【】]/g, '');
}

function includesAny(text, words) {
  const t = String(text || '');
  return words.some((w) => t.includes(w));
}

function parseCount(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*(切れ|個|本|杯|枚|皿|袋|パック)/);
  if (!m) return null;
  return {
    value: Number(m[1]),
    unit: m[2],
  };
}

function looksLikeOnlyOverwrite(text) {
  const t = String(text || '');
  return (
    t.includes('だけ') ||
    t.includes('のみ') ||
    t.includes('これだけ') ||
    t.includes('だけです') ||
    t.includes('のみです')
  );
}

function looksLikeDrinkCorrectionOnly(text) {
  const t = String(text || '');
  return includesAny(t, [
    'お酒ではない',
    'ノンアル',
    'ジャスミンティー',
    '烏龍茶',
    'ウーロン茶',
    '緑茶',
    '麦茶',
    '紅茶',
    '水です',
    'お茶です',
  ]);
}

function estimateKcalForKnownItem(name, amountText) {
  const n = String(name || '');
  const amount = String(amountText || '');
  const count = parseCount(amount);

  if (n.includes('サーモン') && n.includes('刺身')) {
    const pieces = count?.unit === '切れ' ? count.value : null;
    if (pieces != null) {
      return {
        kcal: Math.round(pieces * 30),
        min: Math.round(pieces * 25),
        max: Math.round(pieces * 35),
      };
    }
    return { kcal: 140, min: 120, max: 160 };
  }

  if ((n.includes('白身') || n.includes('鯛') || n.includes('ヒラメ')) && n.includes('刺身')) {
    const pieces = count?.unit === '切れ' ? count.value : null;
    if (pieces != null) {
      return {
        kcal: Math.round(pieces * 15),
        min: Math.round(pieces * 10),
        max: Math.round(pieces * 20),
      };
    }
    return { kcal: 60, min: 40, max: 80 };
  }

  if (includesAny(n, ['ホンビノス', 'ボンビノス']) && includesAny(amount, ['1個', '１個'])) {
    return { kcal: 25, min: 18, max: 35 };
  }

  if (n.includes('ホタテ') && includesAny(amount, ['1個', '１個'])) {
    return { kcal: 20, min: 15, max: 30 };
  }

  if (n.includes('焼きおにぎり')) {
    return { kcal: 200, min: 180, max: 230 };
  }

  if (n.includes('プレミアムチョコクロ')) {
    return { kcal: 280, min: 250, max: 300 };
  }

  if (n.includes('フレンチトースト')) {
    return { kcal: 320, min: 280, max: 360 };
  }

  if (includesAny(n, ['わさび', 'ツマ', 'つま', '大根'])) {
    return { kcal: 5, min: 0, max: 10 };
  }

  if (n.includes('わかめ') || n.includes('ワカメ')) {
    return { kcal: 5, min: 0, max: 10 };
  }

  return null;
}

function applyKnownFoodCorrections(items) {
  const normalizedItems = (items || []).map(normalizeFoodItem);

  let total = 0;
  let min = 0;
  let max = 0;

  const updated = normalizedItems.map((item) => {
    const known = estimateKcalForKnownItem(item.name, item.estimated_amount);
    if (!known) {
      const kcal = Math.max(0, toNumberOrNull(item.estimated_kcal) ?? 0);
      total += kcal;
      min += Math.max(0, Math.round(kcal * 0.85));
      max += Math.max(0, Math.round(kcal * 1.2));
      return item;
    }

    total += known.kcal;
    min += known.min;
    max += known.max;

    return {
      ...item,
      estimated_kcal: known.kcal,
      confidence: Math.max(Number(item.confidence || 0), 0.9),
      needs_confirmation: false,
    };
  });

  return {
    items: updated,
    total,
    min,
    max,
  };
}

function itemMatchesKeyword(itemName, keyword) {
  const itemNorm = normalizeText(itemName);
  const keyNorm = normalizeText(keyword);

  if (!itemNorm || !keyNorm) return false;
  if (itemNorm.includes(keyNorm) || keyNorm.includes(itemNorm)) return true;

  const synonymGroups = [
    ['白身魚', '白身魚刺身', '白身', '鯛', 'ヒラメ'],
    ['サーモン', 'サーモン刺身', '鮭', 'サーモンさしみ'],
    ['わさび', 'ワサビ'],
    ['わかめ', 'ワカメ'],
    ['つま', 'ツマ', '大根のつま', '大根ツマ'],
    ['ホンビノス', 'ボンビノス', 'ホンビノス貝', 'ボンビノス貝'],
  ];

  for (const group of synonymGroups) {
    const hitItem = group.some((w) => itemNorm.includes(normalizeText(w)));
    const hitKey = group.some((w) => keyNorm.includes(normalizeText(w)));
    if (hitItem && hitKey) return true;
  }

  return false;
}

function extractNegativeTargets(text) {
  const raw = String(text || '').trim();
  const targets = [];

  const patterns = [
    /(.+?)はありません/g,
    /(.+?)はないです/g,
    /(.+?)はない/g,
    /(.+?)じゃないです/g,
    /(.+?)ではないです/g,
    /(.+?)ではありません/g,
    /(.+?)じゃない/g,
    /(.+?)違います/g,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(raw)) !== null) {
      const target = safeText(m[1], 80);
      if (target) targets.push(target);
    }
  }

  return uniqueStrings(targets);
}

function buildRemoveOnlyCorrection(currentMeal, correctionText) {
  const negativeTargets = extractNegativeTargets(correctionText);
  if (!negativeTargets.length) return null;

  const originalItems = Array.isArray(currentMeal.food_items) ? currentMeal.food_items : [];
  const remainingItems = originalItems.filter((item) => {
    return !negativeTargets.some((target) => itemMatchesKeyword(item.name, target));
  });

  if (remainingItems.length === originalItems.length) {
    return null;
  }

  const applied = applyKnownFoodCorrections(remainingItems);

  const mainNames = applied.items
    .map((x) => x.name)
    .filter((name) => !includesAny(String(name || ''), ['わさび', 'ワサビ', 'わかめ', 'ワカメ', 'つま', 'ツマ', '大根']))
    .join(' / ');

  return {
    overwrite_all: false,
    correction_type: 'remove_specific_items',
    corrected_meal_label: safeText(mainNames || currentMeal.meal_label || '食事', 100),
    corrected_food_items: applied.items,
    corrected_estimated_kcal: applied.total,
    corrected_kcal_min: applied.min,
    corrected_kcal_max: applied.max,
    corrected_protein_g: currentMeal.protein_g ?? null,
    corrected_fat_g: currentMeal.fat_g ?? null,
    corrected_carbs_g: currentMeal.carbs_g ?? null,
    uncertainty_notes: [],
    confirmation_questions: [],
    correction_summary: `「${negativeTargets.join(' / ')}」を削除して再計算しました。`,
  };
}

function buildDeterministicOverwrite(currentMeal, correctionText) {
  const t = String(correctionText || '').trim();

  if (!looksLikeOnlyOverwrite(t)) return null;

  if (t.includes('サーモン') && t.includes('刺身')) {
    const count = parseCount(t);
    const amountText =
      count && count.unit === '切れ'
        ? `${count.value}切れ`
        : '1皿';

    const items = [
      {
        name: 'サーモン刺身',
        estimated_amount: amountText,
        estimated_kcal: 0,
        category: 'fish',
        confidence: 0.98,
        needs_confirmation: false,
      },
    ];

    const hasWakame = currentMeal.food_items.some((x) => String(x.name || '').includes('わかめ') || String(x.name || '').includes('ワカメ'));
    const hasWasabi = currentMeal.food_items.some((x) => String(x.name || '').includes('わさび') || String(x.name || '').includes('ワサビ'));
    const hasTsuma = currentMeal.food_items.some((x) => String(x.name || '').includes('つま') || String(x.name || '').includes('ツマ') || String(x.name || '').includes('大根'));

    if (hasWakame) {
      items.push({
        name: 'わかめ',
        estimated_amount: '少量',
        estimated_kcal: 0,
        category: 'side',
        confidence: 0.9,
        needs_confirmation: false,
      });
    }

    if (hasWasabi) {
      items.push({
        name: 'わさび',
        estimated_amount: '少量',
        estimated_kcal: 0,
        category: 'side',
        confidence: 0.9,
        needs_confirmation: false,
      });
    }

    if (hasTsuma) {
      items.push({
        name: '大根のつま',
        estimated_amount: '適量',
        estimated_kcal: 0,
        category: 'side',
        confidence: 0.9,
        needs_confirmation: false,
      });
    }

    const applied = applyKnownFoodCorrections(items);

    return {
      overwrite_all: true,
      correction_type: 'overwrite_from_user_text',
      corrected_meal_label: 'サーモン刺身',
      corrected_food_items: applied.items,
      corrected_estimated_kcal: applied.total,
      corrected_kcal_min: applied.min,
      corrected_kcal_max: applied.max,
      corrected_protein_g: null,
      corrected_fat_g: null,
      corrected_carbs_g: null,
      uncertainty_notes: [],
      confirmation_questions: [],
      correction_summary: `ユーザー訂正を最優先し、サーモン刺身${amountText}中心で再構成しました。`,
    };
  }

  return null;
}

function buildCorrectionPrompt(currentMeal, correctionText) {
  const currentSummary = {
    meal_label: currentMeal.meal_label,
    food_items: currentMeal.food_items,
    estimated_kcal: currentMeal.estimated_kcal,
    kcal_min: currentMeal.kcal_min,
    kcal_max: currentMeal.kcal_max,
  };

  return [
    'あなたは日本向けの食事記録訂正アシスタントです。',
    '最優先ルール: ユーザーの訂正文を、元の画像推定や元のAI推定より優先してください。',
    '「Aはありません」「Aではない」「Aじゃない」は、食事全体の否定ではなく、その食材Aだけを削除する訂正として扱ってください。',
    '「だけ」「のみ」が含まれる場合は、ユーザー文だけを正として再構成してください。',
    '食材を追加で想像しないでください。',
    '不明な食材を復活させないでください。',
    '刺身は高く見積もりすぎないでください。',
    'サーモン刺身は1切れ25〜35kcal程度を基準にしてください。',
    '白身魚刺身は1切れ10〜20kcal程度を基準にしてください。',
    'わかめ、わさび、ツマなどの少量付け合わせは過大評価しないでください。',
    '必ずJSONだけを返してください。',
    '',
    `現在の食事データ: ${JSON.stringify(currentSummary)}`,
    `ユーザー訂正文: ${correctionText}`,
  ].join('\n');
}

function mergeCorrectionResult(currentMeal, correctionResult, correctionText) {
  const overwriteAll =
    !!correctionResult?.overwrite_all ||
    looksLikeOnlyOverwrite(correctionText);

  const correctedItems = Array.isArray(correctionResult?.corrected_food_items)
    ? correctionResult.corrected_food_items.map(normalizeFoodItem).filter((x) => x.name)
    : [];

  const baseMeal = overwriteAll
    ? {
        ...currentMeal,
        food_items: [],
      }
    : {
        ...currentMeal,
      };

  let nextItems = overwriteAll
    ? correctedItems
    : correctedItems.length
      ? correctedItems
      : baseMeal.food_items;

  if (!overwriteAll && looksLikeDrinkCorrectionOnly(correctionText) && correctedItems.length) {
    nextItems = correctedItems;
  }

  const applied = applyKnownFoodCorrections(nextItems);

  const estimatedKcal =
    toNumberOrNull(correctionResult?.corrected_estimated_kcal) != null &&
    !overwriteAll
      ? Math.max(0, toNumberOrNull(correctionResult?.corrected_estimated_kcal))
      : applied.total;

  const kcalMin =
    toNumberOrNull(correctionResult?.corrected_kcal_min) != null &&
    !overwriteAll
      ? Math.max(0, toNumberOrNull(correctionResult?.corrected_kcal_min))
      : applied.min;

  const kcalMax =
    toNumberOrNull(correctionResult?.corrected_kcal_max) != null &&
    !overwriteAll
      ? Math.max(0, toNumberOrNull(correctionResult?.corrected_kcal_max))
      : applied.max;

  const mealLabel =
    safeText(correctionResult?.corrected_meal_label, 100) ||
    safeText(
      applied.items
        .filter((x) => !includesAny(String(x.name || ''), ['わさび', 'ワサビ', 'わかめ', 'ワカメ', 'つま', 'ツマ', '大根']))
        .map((x) => x.name)
        .join(' / '),
      100
    ) ||
    currentMeal.meal_label ||
    '食事';

  return {
    ...baseMeal,
    meal_label: mealLabel,
    food_items: applied.items,
    estimated_kcal: estimatedKcal,
    kcal_min: kcalMin,
    kcal_max: Math.max(kcalMin, kcalMax),
    protein_g: toNumberOrNull(correctionResult?.corrected_protein_g) ?? baseMeal.protein_g ?? null,
    fat_g: toNumberOrNull(correctionResult?.corrected_fat_g) ?? baseMeal.fat_g ?? null,
    carbs_g: toNumberOrNull(correctionResult?.corrected_carbs_g) ?? baseMeal.carbs_g ?? null,
    confidence: overwriteAll ? 0.97 : 0.94,
    uncertainty_notes: uniqueStrings(correctionResult?.uncertainty_notes || []),
    confirmation_questions: uniqueStrings(correctionResult?.confirmation_questions || []),
    ai_comment: safeText(
      correctionResult?.correction_summary || '訂正内容を反映しました。',
      1000
    ),
    raw_model_json: {
      ...(baseMeal.raw_model_json || {}),
      correction_text: correctionText,
      correction_result: correctionResult,
      overwrite_all: overwriteAll,
    },
  };
}

async function applyMealCorrection(currentMealInput, correctionText) {
  const currentMeal = normalizeMeal(currentMealInput);

  const removeOnly = buildRemoveOnlyCorrection(currentMeal, correctionText);
  if (removeOnly) {
    return mergeCorrectionResult(currentMeal, removeOnly, correctionText);
  }

  const deterministic = buildDeterministicOverwrite(currentMeal, correctionText);
  if (deterministic) {
    return mergeCorrectionResult(currentMeal, deterministic, correctionText);
  }

  const prompt = buildCorrectionPrompt(currentMeal, correctionText);
  const aiResult = await generateJsonOnly(prompt, MEAL_CORRECTION_SCHEMA, 0.15);

  return mergeCorrectionResult(currentMeal, aiResult, correctionText);
}

function buildMealCorrectionConfirmationMessage(meal) {
  const lines = [
    '訂正内容を反映しました。',
    `料理: ${meal.meal_label || '食事'}`,
    `推定カロリー: ${formatKcalRange(meal.estimated_kcal, meal.kcal_min, meal.kcal_max)}`,
    Array.isArray(meal.food_items) && meal.food_items.length
      ? `内容: ${meal.food_items.map((x) => {
          const amount = safeText(x.estimated_amount, 40);
          return amount ? `${x.name} ${amount}` : x.name;
        }).join(' / ')}`
      : null,
    Array.isArray(meal.uncertainty_notes) && meal.uncertainty_notes.length
      ? `確認したい点: ${meal.uncertainty_notes.join(' / ')}`
      : null,
    Array.isArray(meal.confirmation_questions) && meal.confirmation_questions.length
      ? meal.confirmation_questions.join('\n')
      : null,
    '合っていれば保存、違うところがあればボタンか文字で訂正してください。',
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  MEAL_CORRECTION_SCHEMA,
  applyMealCorrection,
  buildMealCorrectionConfirmationMessage,
};
