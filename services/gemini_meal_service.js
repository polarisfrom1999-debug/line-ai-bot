'use strict';

/**
 * services/gemini_meal_service.js
 *
 * 目的:
 * - Gemini 主導で食事テキスト / 食事画像 / 訂正文を解析する
 * - 栄養表示は PFC ではなく、日本語表記（たんぱく質・脂質・糖質）を優先
 * - 記録OSへ渡しやすい candidate 形式へ寄せる
 *
 * 使い方の想定:
 * - index.js から食事テキスト解析 / 訂正文解析 / 画像解析の入口として呼ぶ
 * - 返り値は meal_result と record candidate を持つ
 *
 * 注意:
 * - 既存の gemini_service.js がある前提でつなぎやすい構成
 * - 画像実接続がまだ別実装の場合でも、text fallback で壊れにくい
 */

const {
  normalizeRecordCandidate,
  toNumberOrNull,
  safeText,
} = require('./record_normalizer_service');

let geminiCore = {};
try {
  geminiCore = require('./gemini_service');
} catch (_err) {
  geminiCore = {};
}

const generateJsonOnly =
  typeof geminiCore.generateJsonOnly === 'function'
    ? geminiCore.generateJsonOnly
    : async () => null;

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return fallback;
  }
}

function round1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function round0(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function buildMealAnalysisSchema() {
  return {
    type: 'object',
    properties: {
      intent: { type: 'string' },
      is_meal_related: { type: 'boolean' },
      meal_label: { type: 'string' },
      meal_time_hint: { type: 'string' },
      estimated_kcal: { type: 'number' },
      kcal_min: { type: 'number' },
      kcal_max: { type: 'number' },
      protein_g: { type: 'number' },
      fat_g: { type: 'number' },
      carbs_g: { type: 'number' },
      food_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            amount_text: { type: 'string' },
            estimated_kcal: { type: 'number' },
            confidence: { type: 'number' },
          },
          required: ['name'],
        },
      },
      notes: { type: 'string' },
      needs_confirmation: { type: 'boolean' },
      confidence: { type: 'number' },
      should_not_save_yet: { type: 'boolean' },
      rejection_reason: { type: 'string' },
    },
    required: ['is_meal_related'],
  };
}

function buildMealPrompt({ userText = '', mode = 'text', previousMealSummary = '' } = {}) {
  return `
あなたは、LINE上で高齢者にも分かりやすく寄り添う食事解析AIです。
目的は、食事記録になりそうな内容だけを丁寧に見抜き、相談文や雑談文を食事記録として誤保存しないことです。

最重要ルール:
- 食事解析は Gemini 主導で行う
- 栄養表示は PFC ではなく、日本語表記（たんぱく質・脂質・糖質）で扱う
- 料理名や食材名は、できるだけ自然な日本語でまとめる
- 曖昧なら無理に断定しない
- 相談文、雑談文、感想文は is_meal_related=false にする
- 「お腹いっぱい食べたい」「何を食べようかな」「痛くて食欲ない」などは食事記録ではない
- 訂正文では、前回内容を参照しつつ再計算する
- 返答は JSON のみ

解析モード: ${mode}
前回の食事要約: ${safeText(previousMealSummary)}
利用者入力:
${safeText(userText)}
`.trim();
}

function normalizeFoodItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      name: safeText(item?.name || item?.food_name || item?.dish_name || '不明な料理'),
      amount_text: safeText(item?.amount_text || item?.estimated_amount || item?.amount || ''),
      estimated_kcal: round0(item?.estimated_kcal),
      confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0.5,
    }))
    .filter((item) => item.name);
}

function normalizeMealResult(raw = {}) {
  return {
    intent: safeText(raw.intent || ''),
    is_meal_related: raw.is_meal_related === true,
    meal_label: safeText(raw.meal_label || raw.corrected_meal_label || ''),
    meal_time_hint: safeText(raw.meal_time_hint || ''),
    estimated_kcal: round0(raw.estimated_kcal ?? raw.corrected_estimated_kcal),
    kcal_min: round0(raw.kcal_min ?? raw.corrected_kcal_min),
    kcal_max: round0(raw.kcal_max ?? raw.corrected_kcal_max),
    protein_g: round1(raw.protein_g ?? raw.corrected_protein_g),
    fat_g: round1(raw.fat_g ?? raw.corrected_fat_g),
    carbs_g: round1(raw.carbs_g ?? raw.corrected_carbs_g),
    food_items: normalizeFoodItems(raw.food_items || raw.corrected_food_items || []),
    notes: safeText(raw.notes || raw.rejection_reason || ''),
    needs_confirmation: raw.needs_confirmation !== false,
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0.65,
    should_not_save_yet: raw.should_not_save_yet === true,
    rejection_reason: safeText(raw.rejection_reason || ''),
  };
}

function buildFallbackMealLabel(items = []) {
  const names = (Array.isArray(items) ? items : [])
    .map((item) => safeText(item?.name))
    .filter(Boolean)
    .slice(0, 3);

  if (!names.length) return '食事';
  return names.join('、');
}

function buildMealCandidateFromResult(result = {}, source = 'text') {
  const meal = normalizeMealResult(result);

  if (!meal.is_meal_related) return null;
  if (meal.should_not_save_yet) return null;

  return normalizeRecordCandidate({
    type: 'meal',
    confidence: meal.confidence || 0.65,
    needs_confirmation: meal.needs_confirmation !== false,
    source,
    parsed_payload: {
      meal_label: meal.meal_label || buildFallbackMealLabel(meal.food_items),
      meal_time_hint: meal.meal_time_hint,
      estimated_kcal: meal.estimated_kcal,
      kcal_min: meal.kcal_min,
      kcal_max: meal.kcal_max,
      protein_g: meal.protein_g,
      fat_g: meal.fat_g,
      carbs_g: meal.carbs_g,
      food_items: meal.food_items,
      notes: meal.notes,
    },
    meta: {
      gemini_intent: meal.intent,
      rejection_reason: meal.rejection_reason,
    },
  });
}

function buildMealReplyPreview(candidate = null) {
  if (!candidate) {
    return {
      text: '食事記録として急がず、まずは会話として受け取るほうが自然そうです。',
      shouldSuggestSave: false,
    };
  }

  const p = candidate.parsed_payload || {};
  const lines = [];
  lines.push('食事内容を整理しました。');

  if (p.meal_label) lines.push(`料理: ${safeText(p.meal_label)}`);
  if (toNumberOrNull(p.estimated_kcal) !== null) {
    const kcal = toNumberOrNull(p.estimated_kcal);
    const kcalMin = toNumberOrNull(p.kcal_min);
    const kcalMax = toNumberOrNull(p.kcal_max);
    if (kcalMin !== null && kcalMax !== null) {
      lines.push(`推定カロリー: ${kcal} kcal（${kcalMin}〜${kcalMax} kcal）`);
    } else {
      lines.push(`推定カロリー: ${kcal} kcal`);
    }
  }

  if (
    toNumberOrNull(p.protein_g) !== null ||
    toNumberOrNull(p.fat_g) !== null ||
    toNumberOrNull(p.carbs_g) !== null
  ) {
    lines.push(
      '栄養の目安: ' +
      [
        toNumberOrNull(p.protein_g) !== null ? `たんぱく質 ${toNumberOrNull(p.protein_g)}g` : null,
        toNumberOrNull(p.fat_g) !== null ? `脂質 ${toNumberOrNull(p.fat_g)}g` : null,
        toNumberOrNull(p.carbs_g) !== null ? `糖質 ${toNumberOrNull(p.carbs_g)}g` : null,
      ].filter(Boolean).join(' / ')
    );
  }

  lines.push('合っていれば保存、違うところがあればそのまま訂正してくださいね。');

  return {
    text: lines.join('\n'),
    shouldSuggestSave: true,
  };
}

async function analyzeMealText({
  userText = '',
  previousMealSummary = '',
} = {}) {
  const prompt = buildMealPrompt({
    userText,
    previousMealSummary,
    mode: 'text',
  });

  const raw = await generateJsonOnly(prompt, buildMealAnalysisSchema());
  const parsed = normalizeMealResult(
    typeof raw === 'string' ? safeJsonParse(raw, {}) : (raw || {})
  );

  return {
    meal_result: parsed,
    candidate: buildMealCandidateFromResult(parsed, 'text'),
  };
}

async function analyzeMealCorrection({
  correctionText = '',
  previousMealSummary = '',
} = {}) {
  const prompt = buildMealPrompt({
    userText: correctionText,
    previousMealSummary,
    mode: 'correction',
  });

  const raw = await generateJsonOnly(prompt, buildMealAnalysisSchema());
  const parsed = normalizeMealResult(
    typeof raw === 'string' ? safeJsonParse(raw, {}) : (raw || {})
  );

  return {
    meal_result: parsed,
    candidate: buildMealCandidateFromResult(parsed, 'correction'),
  };
}

async function analyzeMealImage({
  imageCaption = '',
  previousMealSummary = '',
} = {}) {
  const prompt = buildMealPrompt({
    userText: imageCaption || '食事画像の内容を解析してください',
    previousMealSummary,
    mode: 'image',
  });

  const raw = await generateJsonOnly(prompt, buildMealAnalysisSchema());
  const parsed = normalizeMealResult(
    typeof raw === 'string' ? safeJsonParse(raw, {}) : (raw || {})
  );

  return {
    meal_result: parsed,
    candidate: buildMealCandidateFromResult(parsed, 'image'),
  };
}

module.exports = {
  buildMealAnalysisSchema,
  buildMealPrompt,
  normalizeFoodItems,
  normalizeMealResult,
  buildFallbackMealLabel,
  buildMealCandidateFromResult,
  buildMealReplyPreview,
  analyzeMealText,
  analyzeMealCorrection,
  analyzeMealImage,
};
