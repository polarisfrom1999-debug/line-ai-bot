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

function itemMatchesKeyword(itemName, keyword) {
  const itemNorm = normalizeText(itemName);
  const keyNorm = normalizeText(keyword);

  if (!itemNorm || !keyNorm) return false;
  if (itemNorm.includes(keyNorm) || keyNorm.includes(itemNorm)) return true;

  const synonymGroups = [
    ['白身魚', '白身魚刺身', '白身', '鯛', 'ヒラメ'],
    ['サーモン', 'サーモン刺身', '鮭'],
    ['わさび', 'ワサビ'],
    ['わかめ', 'ワカメ'],
    ['つま', 'ツマ', '大根のつま', '大根ツマ'],
    ['水', 'ミネラルウォーター'],
    ['お茶', 'ジャスミンティー', '緑茶', '烏龍茶', 'ウーロン茶', '麦茶', '紅茶'],
    ['コーヒー', 'カフェラテ', 'ラテ', 'ミルクコーヒー'],
  ];

  for (const group of synonymGroups) {
    const hitItem = group.some((w) => itemNorm.includes(normalizeText(w)));
    const hitKey = group.some((w) => keyNorm.includes(normalizeText(w)));
    if (hitItem && hitKey) return true;
  }

  return false;
}

function parseCount(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*(切れ|個|本|杯|枚|皿|袋|パック)/);
  if (!m) return null;
  return { value: Number(m[1]), unit: m[2] };
}

function buildFromPhotoPriority(currentMeal) {
  return Array.isArray(currentMeal.food_items)
    ? currentMeal.food_items.map((x) => normalizeFoodItem(x))
    : [];
}

function recalcKnownRanges(items, fallbackTotal = null, fallbackMin = null, fallbackMax = null) {
  const list = (items || []).map(normalizeFoodItem);
  let total = 0;
  let min = 0;
  let max = 0;

  for (const item of list) {
    const kcal = Math.max(0, toNumberOrNull(item.estimated_kcal) ?? 0);
    total += kcal;
    min += Math.max(0, Math.round(kcal * 0.82));
    max += Math.max(min, Math.round(kcal * 1.18));
  }

  if (!list.length) {
    total = Math.max(0, toNumberOrNull(fallbackTotal) ?? 0);
    min = Math.max(0, toNumberOrNull(fallbackMin) ?? Math.round(total * 0.82));
    max = Math.max(min, toNumberOrNull(fallbackMax) ?? Math.round(total * 1.18));
  }

  return { items: list, total, min, max };
}

function extractNegativeTargets(text) {
  const raw = String(text || '').trim();
  const targets = [];
  const patterns = [
    /(.+?)はありません/g,
    /(.+?)はないです/g,
    /(.+?)はない/g,
    /(.+?)ではありません/g,
    /(.+?)ではないです/g,
    /(.+?)ではない/g,
    /(.+?)じゃないです/g,
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

  const originalItems = buildFromPhotoPriority(currentMeal);
  const remainingItems = originalItems.filter((item) => {
    return !negativeTargets.some((target) => itemMatchesKeyword(item.name, target));
  });

  if (remainingItems.length === originalItems.length) return null;

  const recalced = recalcKnownRanges(remainingItems);
  const mainNames = remainingItems
    .map((x) => x.name)
    .filter((name) => !/わさび|ワサビ|わかめ|ワカメ|つま|ツマ|大根/.test(String(name || '')))
    .join(' / ');

  return {
    overwrite_all: false,
    correction_type: 'remove_specific_items',
    corrected_meal_label: safeText(mainNames || currentMeal.meal_label || '食事', 100),
    corrected_food_items: remainingItems,
    corrected_estimated_kcal: recalced.total,
    corrected_kcal_min: recalced.min,
    corrected_kcal_max: recalced.max,
    corrected_protein_g: currentMeal.protein_g ?? null,
    corrected_fat_g: currentMeal.fat_g ?? null,
    corrected_carbs_g: currentMeal.carbs_g ?? null,
    uncertainty_notes: [],
    confirmation_questions: [],
    correction_summary: `「${negativeTargets.join(' / ')}」を削除して再整理しました。`,
  };
}

function buildDrinkOverrideCorrection(currentMeal, correctionText) {
  const t = String(correctionText || '').trim();
  if (!t) return null;

  let newDrinkName = null;
  let newDrinkKcal = null;

  if (/^水です?$/.test(t) || t === '水') {
    newDrinkName = '水';
    newDrinkKcal = 0;
  } else if (/ジャスミンティー/.test(t)) {
    newDrinkName = 'ジャスミンティー';
    newDrinkKcal = 0;
  } else if (/烏龍茶|ウーロン茶/.test(t)) {
    newDrinkName = '烏龍茶';
    newDrinkKcal = 0;
  } else if (/緑茶/.test(t)) {
    newDrinkName = '緑茶';
    newDrinkKcal = 0;
  } else if (/麦茶/.test(t)) {
    newDrinkName = '麦茶';
    newDrinkKcal = 0;
  } else if (/紅茶/.test(t)) {
    newDrinkName = '紅茶';
    newDrinkKcal = 0;
  } else if (/お茶です?$/.test(t) || t === 'お茶') {
    newDrinkName = 'お茶';
    newDrinkKcal = 0;
  }

  if (!newDrinkName) return null;

  const baseItems = buildFromPhotoPriority(currentMeal);
  const drinkRegex = /コーヒー|カフェラテ|ラテ|ミルクティー|紅茶|お茶|水|ドリンク|飲み物|ジュース/;

  let replaced = false;
  const nextItems = baseItems.map((item) => {
    if (drinkRegex.test(String(item.name || '')) && !replaced) {
      replaced = true;
      return {
        ...item,
        name: newDrinkName,
        estimated_amount: item.estimated_amount || '1杯',
        estimated_kcal: newDrinkKcal,
        confidence: 0.99,
        needs_confirmation: false,
        category: item.category || 'drink',
      };
    }
    return item;
  });

  if (!replaced) {
    nextItems.push({
      name: newDrinkName,
      estimated_amount: '1杯',
      estimated_kcal: newDrinkKcal,
      category: 'drink',
      confidence: 0.99,
      needs_confirmation: false,
    });
  }

  const recalced = recalcKnownRanges(nextItems);
  return {
    overwrite_all: false,
    correction_type: 'replace_drink_with_user_text',
    corrected_meal_label: currentMeal.meal_label,
    corrected_food_items: nextItems,
    corrected_estimated_kcal: recalced.total,
    corrected_kcal_min: recalced.min,
    corrected_kcal_max: recalced.max,
    corrected_protein_g: currentMeal.protein_g ?? null,
    corrected_fat_g: currentMeal.fat_g ?? null,
    corrected_carbs_g: currentMeal.carbs_g ?? null,
    uncertainty_notes: [],
    confirmation_questions: [],
    correction_summary: `飲み物を「${newDrinkName}」として反映しました。`,
  };
}

function looksLikeOnlyOverwrite(text) {
  const t = String(text || '');
  return t.includes('だけ') || t.includes('のみ') || t.includes('これだけ') || t.includes('だけです') || t.includes('のみです');
}

function buildDeterministicOverwrite(currentMeal, correctionText) {
  const t = String(correctionText || '').trim();
  if (!looksLikeOnlyOverwrite(t)) return null;

  if (t.includes('サーモン') && t.includes('刺身')) {
    const count = parseCount(t);
    const pieces = count && count.unit === '切れ' ? count.value : 4;
    const salmonKcal = Math.round(pieces * 30);
    const items = [
      {
        name: 'サーモン刺身',
        estimated_amount: `${pieces}切れ`,
        estimated_kcal: salmonKcal,
        category: 'fish',
        confidence: 0.99,
        needs_confirmation: false,
      },
    ];

    for (const item of buildFromPhotoPriority(currentMeal)) {
      if (/わさび|ワサビ/.test(item.name)) items.push({ ...item, estimated_kcal: 0, needs_confirmation: false, confidence: 0.95 });
      if (/わかめ|ワカメ/.test(item.name)) items.push({ ...item, estimated_kcal: 5, needs_confirmation: false, confidence: 0.95 });
      if (/つま|ツマ|大根/.test(item.name)) items.push({ ...item, estimated_kcal: 5, needs_confirmation: false, confidence: 0.95 });
    }

    const recalced = recalcKnownRanges(items);
    return {
      overwrite_all: true,
      correction_type: 'overwrite_from_user_text',
      corrected_meal_label: 'サーモン刺身',
      corrected_food_items: recalced.items,
      corrected_estimated_kcal: recalced.total,
      corrected_kcal_min: recalced.min,
      corrected_kcal_max: recalced.max,
      corrected_protein_g: currentMeal.protein_g ?? null,
      corrected_fat_g: currentMeal.fat_g ?? null,
      corrected_carbs_g: currentMeal.carbs_g ?? null,
      uncertainty_notes: [],
      confirmation_questions: [],
      correction_summary: 'ユーザーの訂正文を優先して内容を更新しました。',
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
    protein_g: currentMeal.protein_g,
    fat_g: currentMeal.fat_g,
    carbs_g: currentMeal.carbs_g,
  };

  return [
    'あなたは日本向けの食事記録訂正アシスタントです。',
    '最優先ルール: 元の写真判定や食事判定を土台として保ちつつ、ユーザーの訂正文を最優先で反映してください。',
    '「Aはありません」「Aではない」は、食事全体の否定ではなく、その対象Aだけを削除してください。',
    '「水です」「お茶です」のような短文は、対象飲み物をその内容に確定上書きしてください。',
    '「だけ」「のみ」がある場合は、その内容で再構成してください。',
    '食材を追加で想像しないでください。',
    'すでに存在する他の食材は、ユーザーが否定していない限り基本的に残してください。',
    'たんぱく質・脂質・糖質も大きく不自然にならない範囲で返してください。',
    '確認質問は本当に必要な時だけ入れてください。',
    '必ずJSONだけを返してください。',
    '',
    `現在の食事データ: ${JSON.stringify(currentSummary)}`,
    `ユーザー訂正文: ${correctionText}`,
  ].join('\n');
}

function mergeCorrectionResult(currentMeal, correctionResult, correctionText) {
  const overwriteAll = !!correctionResult?.overwrite_all || looksLikeOnlyOverwrite(correctionText);
  const correctedItems = Array.isArray(correctionResult?.corrected_food_items)
    ? correctionResult.corrected_food_items.map(normalizeFoodItem).filter((x) => x.name)
    : [];

  const nextItems = overwriteAll
    ? correctedItems
    : (correctedItems.length ? correctedItems : buildFromPhotoPriority(currentMeal));

  const recalced = recalcKnownRanges(
    nextItems,
    correctionResult?.corrected_estimated_kcal,
    correctionResult?.corrected_kcal_min,
    correctionResult?.corrected_kcal_max
  );

  const mealLabel = safeText(correctionResult?.corrected_meal_label, 100)
    || currentMeal.meal_label
    || safeText(
      nextItems
        .map((x) => x.name)
        .filter((name) => !/わさび|ワサビ|わかめ|ワカメ|つま|ツマ|大根/.test(String(name || '')))
        .join(' / '),
      100
    )
    || '食事';

  return {
    ...currentMeal,
    meal_label: mealLabel,
    food_items: recalced.items,
    estimated_kcal: recalced.total,
    kcal_min: recalced.min,
    kcal_max: Math.max(recalced.min, recalced.max),
    protein_g: toNumberOrNull(correctionResult?.corrected_protein_g) ?? currentMeal.protein_g ?? null,
    fat_g: toNumberOrNull(correctionResult?.corrected_fat_g) ?? currentMeal.fat_g ?? null,
    carbs_g: toNumberOrNull(correctionResult?.corrected_carbs_g) ?? currentMeal.carbs_g ?? null,
    confidence: overwriteAll ? 0.98 : 0.95,
    uncertainty_notes: uniqueStrings(correctionResult?.uncertainty_notes || []),
    confirmation_questions: uniqueStrings(correctionResult?.confirmation_questions || []),
    ai_comment: safeText(correctionResult?.correction_summary || '訂正内容を反映しました。', 1000),
    raw_model_json: {
      ...(currentMeal.raw_model_json || {}),
      correction_text: correctionText,
      correction_result: correctionResult,
      overwrite_all: overwriteAll,
    },
  };
}

async function applyMealCorrection(currentMealInput, correctionText) {
  const currentMeal = normalizeMeal(currentMealInput);

  const removeOnly = buildRemoveOnlyCorrection(currentMeal, correctionText);
  if (removeOnly) return mergeCorrectionResult(currentMeal, removeOnly, correctionText);

  const drinkOverride = buildDrinkOverrideCorrection(currentMeal, correctionText);
  if (drinkOverride) return mergeCorrectionResult(currentMeal, drinkOverride, correctionText);

  const deterministic = buildDeterministicOverwrite(currentMeal, correctionText);
  if (deterministic) return mergeCorrectionResult(currentMeal, deterministic, correctionText);

  const prompt = buildCorrectionPrompt(currentMeal, correctionText);
  const aiResult = await generateJsonOnly(prompt, MEAL_CORRECTION_SCHEMA, 0.15);
  return mergeCorrectionResult(currentMeal, aiResult, correctionText);
}

function roundMacro(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function buildMealCorrectionConfirmationMessage(meal) {
  const protein = roundMacro(meal?.protein_g);
  const fat = roundMacro(meal?.fat_g);
  const carbs = roundMacro(meal?.carbs_g);

  const lines = [
    '訂正内容を反映しました。',
    `料理: ${meal.meal_label || '食事'}`,
    `推定カロリー: ${formatKcalRange(meal.estimated_kcal, meal.kcal_min, meal.kcal_max)}`,
  ];

  if (protein != null || fat != null || carbs != null) {
    lines.push('');
    lines.push('栄養の目安');
    if (protein != null) lines.push(`・たんぱく質: ${protein}g`);
    if (fat != null) lines.push(`・脂質: ${fat}g`);
    if (carbs != null) lines.push(`・糖質: ${carbs}g`);
  }

  const shortComment = safeText(meal.ai_comment || '', 120);
  const shortUncertainty = Array.isArray(meal.uncertainty_notes) && meal.uncertainty_notes.length
    ? meal.uncertainty_notes.slice(0, 2).join(' / ')
    : '';

  if (shortComment) {
    lines.push('');
    lines.push(`補足: ${shortComment}`);
  } else if (shortUncertainty) {
    lines.push('');
    lines.push(`補足: ${shortUncertainty}`);
  }

  if (Array.isArray(meal.confirmation_questions) && meal.confirmation_questions.length) {
    lines.push('');
    lines.push(...meal.confirmation_questions.map((x) => `・${x}`));
  }

  lines.push('');
  lines.push('合っていれば保存、違うところがあればボタンか文字で訂正してください。');

  return lines.join('\n');
}

module.exports = {
  MEAL_CORRECTION_SCHEMA,
  applyMealCorrection,
  buildMealCorrectionConfirmationMessage,
};
