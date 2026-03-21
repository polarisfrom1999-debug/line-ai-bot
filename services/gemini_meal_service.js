'use strict';

/**
 * services/gemini_meal_service.js
 *
 * 互換修正版:
 * - analyzeMealPhotoWithGemini を残す
 * - 食事テキスト / 訂正 / 画像の新APIも使える
 * - normalizeGeminiMealResult 互換名を追加
 * - 既存 index.js 向けに analyzeMealTextWithGemini / applyMealCorrectionWithGemini 互換も追加
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


function normalizeMealLabelText(label = '') {
  let value = safeText(label || '', 120);
  if (!value) return '';

  value = value
    .replace(/^(今日は?|きょうは?|今朝|朝|昼|夜|夕食|昼食|朝食)\s*[:：]*/g, '')
    .replace(/(?:でした|です)$/g, '')
    .replace(/(?:を)?(?:食べた|たべた|食べました|たべました|飲んだ|のんだ|飲みました|のみました)$/g, '')
    .replace(/[。！!？?]+$/g, '')
    .trim();

  value = value
    .replace(/緑の飲み物/g, 'お茶')
    .replace(/グリーンドリンク/g, 'お茶')
    .replace(/^らーめん$/i, 'ラーメン')
    .replace(/^ぱん$/i, 'パン');

  if (/ラーメン食べた|らーめん食べた/.test(value)) return 'ラーメン';
  if (/パン食べた|ぱん食べた/.test(value)) return 'パン';
  if (/カレーでした|かれーでした/.test(value)) return 'カレー';

  return value;
}

function chooseNaturalMealLabel(raw = {}) {
  const direct = normalizeMealLabelText(raw?.meal_label || raw?.corrected_meal_label || '');
  const items = Array.isArray(raw?.food_items || raw?.corrected_food_items)
    ? (raw.food_items || raw.corrected_food_items)
    : [];
  const itemNames = items
    .map((item) => normalizeMealLabelText(item?.name || item?.food_name || item?.dish_name || ''))
    .filter(Boolean);

  if (direct) {
    if ((direct === '中華風煮込み' || direct === '煮込み') && itemNames.some((name) => /ラーメン|麺|うどん|そば/.test(name))) {
      return itemNames.find((name) => /ラーメン|麺|うどん|そば/.test(name)) || direct;
    }
    return direct;
  }

  if (!itemNames.length) return '';
  return itemNames.slice(0, 2).join('、');
}

function toMeaningfulMacro(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function mergeMeaningfulNumber(primary, fallback = null) {
  const first = toMeaningfulMacro(primary, null);
  if (first != null) return first;
  const second = toMeaningfulMacro(fallback, null);
  return second;
}

function isDirectMealCorrectionText(text = '') {
  const t = normalizeMealLabelText(text || '');
  if (!t) return false;
  return /^(豚骨ラーメン|味噌ラーメン|醤油ラーメン|塩ラーメン|ラーメン|パン|トースト|カレー|お茶|水|コーヒー|うどん|そば|パスタ|おにぎり)$/.test(t);
}

function buildDirectCorrectionFoodItems(label = '') {
  const normalized = normalizeMealLabelText(label);
  if (!normalized) return [];
  return [{
    name: normalized,
    amount_text: '',
    estimated_kcal: null,
    confidence: 0.92,
  }];
}

function buildSimpleMealHeuristic(label = '', currentMeal = {}) {
  const text = `${safeText(label || '')} ${Array.isArray(currentMeal?.food_items) ? currentMeal.food_items.map((item) => safeText(item?.name || '')).join(' ') : ''}`;
  const normalized = String(text || '').toLowerCase();

  if (/豚骨ラーメン|とんこつラーメン/.test(text)) {
    return { meal_label: '豚骨ラーメン', estimated_kcal: 650, kcal_min: 550, kcal_max: 780, protein_g: 23, fat_g: 24, carbs_g: 68 };
  }
  if (/味噌ラーメン/.test(text)) {
    return { meal_label: '味噌ラーメン', estimated_kcal: 620, kcal_min: 520, kcal_max: 760, protein_g: 22, fat_g: 20, carbs_g: 72 };
  }
  if (/醤油ラーメン/.test(text)) {
    return { meal_label: '醤油ラーメン', estimated_kcal: 540, kcal_min: 440, kcal_max: 660, protein_g: 20, fat_g: 16, carbs_g: 68 };
  }
  if (/塩ラーメン/.test(text)) {
    return { meal_label: '塩ラーメン', estimated_kcal: 520, kcal_min: 430, kcal_max: 640, protein_g: 20, fat_g: 15, carbs_g: 66 };
  }
  if (/ラーメン|らーめん/.test(text)) {
    return { meal_label: 'ラーメン', estimated_kcal: 550, kcal_min: 450, kcal_max: 700, protein_g: 20, fat_g: 18, carbs_g: 65 };
  }
  if (/トースト|パン/.test(text)) {
    return { meal_label: normalizeMealLabelText(label) || 'トースト', estimated_kcal: 300, kcal_min: 220, kcal_max: 380, protein_g: 8, fat_g: 15, carbs_g: 55 };
  }

  return {
    meal_label: normalizeMealLabelText(label) || normalizeMealLabelText(currentMeal?.meal_label || '') || '',
    estimated_kcal: null,
    kcal_min: null,
    kcal_max: null,
    protein_g: null,
    fat_g: null,
    carbs_g: null,
  };
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
  const naturalLabel = chooseNaturalMealLabel(raw);
  return {
    intent: safeText(raw.intent || ''),
    is_meal_related: raw.is_meal_related === true,
    meal_label: naturalLabel,
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

function normalizeGeminiMealResult(raw = {}) {
  return normalizeMealResult(raw);
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

async function analyzeMealText({ userText = '', previousMealSummary = '' } = {}) {
  const prompt = buildMealPrompt({ userText, previousMealSummary, mode: 'text' });
  const raw = await generateJsonOnly(prompt, buildMealAnalysisSchema());
  const parsed = normalizeMealResult(typeof raw === 'string' ? safeJsonParse(raw, {}) : (raw || {}));
  return {
    meal_result: parsed,
    candidate: buildMealCandidateFromResult(parsed, 'text'),
  };
}

async function analyzeMealCorrection({ correctionText = '', previousMealSummary = '' } = {}) {
  const prompt = buildMealPrompt({ userText: correctionText, previousMealSummary, mode: 'correction' });
  const raw = await generateJsonOnly(prompt, buildMealAnalysisSchema());
  const parsed = normalizeMealResult(typeof raw === 'string' ? safeJsonParse(raw, {}) : (raw || {}));
  return {
    meal_result: parsed,
    candidate: buildMealCandidateFromResult(parsed, 'correction'),
  };
}

async function analyzeMealImage({ imageCaption = '', previousMealSummary = '' } = {}) {
  const prompt = buildMealPrompt({
    userText: imageCaption || '食事画像の内容を解析してください',
    previousMealSummary,
    mode: 'image',
  });
  const raw = await generateJsonOnly(prompt, buildMealAnalysisSchema());
  const parsed = normalizeMealResult(typeof raw === 'string' ? safeJsonParse(raw, {}) : (raw || {}));
  return {
    meal_result: parsed,
    candidate: buildMealCandidateFromResult(parsed, 'image'),
  };
}

async function analyzeMealPhotoWithGemini(input = {}) {
  const result = await analyzeMealImage({
    imageCaption: safeText(
      input?.imageCaption ||
      input?.caption ||
      input?.text ||
      input?.userText ||
      '食事画像の内容を解析してください'
    ),
    previousMealSummary: safeText(
      input?.previousMealSummary ||
      input?.previousSummary ||
      ''
    ),
  });

  const candidate = result?.candidate || null;
  const payload = candidate?.parsed_payload || {};

  return {
    success: true,
    meal_result: result?.meal_result || null,
    candidate,
    meal_label: safeText(payload.meal_label || ''),
    estimated_kcal: toNumberOrNull(payload.estimated_kcal),
    kcal_min: toNumberOrNull(payload.kcal_min),
    kcal_max: toNumberOrNull(payload.kcal_max),
    protein_g: toNumberOrNull(payload.protein_g),
    fat_g: toNumberOrNull(payload.fat_g),
    carbs_g: toNumberOrNull(payload.carbs_g),
    food_items: Array.isArray(payload.food_items) ? payload.food_items : [],
    needs_confirmation: candidate?.needs_confirmation !== false,
  };
}

async function analyzeMealTextWithGemini(userText = '', previousMealSummary = '') {
  const directLabel = normalizeMealLabelText(userText || '');
  if (isDirectMealCorrectionText(directLabel)) {
    const heuristic = buildSimpleMealHeuristic(directLabel, {});
    return {
      is_meal: true,
      meal_label: safeText(heuristic.meal_label || directLabel || ''),
      estimated_kcal: heuristic.estimated_kcal,
      kcal_min: heuristic.kcal_min,
      kcal_max: heuristic.kcal_max,
      protein_g: heuristic.protein_g,
      fat_g: heuristic.fat_g,
      carbs_g: heuristic.carbs_g,
      food_items: buildDirectCorrectionFoodItems(directLabel).map((item) => ({
        name: safeText(item?.name || ''),
        estimated_amount: '',
        estimated_kcal: toNumberOrNull(item?.estimated_kcal) || 0,
        confidence: 0.92,
        needs_confirmation: true,
      })),
      confidence: 0.92,
      needs_confirmation: true,
      raw_model_json: { source: 'direct_text_heuristic' },
    };
  }

  const result = await analyzeMealText({ userText, previousMealSummary });
  const payload = result?.candidate?.parsed_payload || result?.meal_result || {};

  if (!result?.meal_result?.is_meal_related) {
    return { is_meal: false, rejection_reason: result?.meal_result?.rejection_reason || '' };
  }

  const heuristic = buildSimpleMealHeuristic(payload.meal_label || result?.meal_result?.meal_label || directLabel || '', result?.meal_result || {});

  return {
    is_meal: true,
    meal_label: safeText(payload.meal_label || result?.meal_result?.meal_label || heuristic.meal_label || ''),
    estimated_kcal: toNumberOrNull(payload.estimated_kcal) ?? heuristic.estimated_kcal,
    kcal_min: toNumberOrNull(payload.kcal_min) ?? heuristic.kcal_min,
    kcal_max: toNumberOrNull(payload.kcal_max) ?? heuristic.kcal_max,
    protein_g: mergeMeaningfulNumber(payload.protein_g, heuristic.protein_g),
    fat_g: mergeMeaningfulNumber(payload.fat_g, heuristic.fat_g),
    carbs_g: mergeMeaningfulNumber(payload.carbs_g, heuristic.carbs_g),
    food_items: Array.isArray(payload.food_items)
      ? payload.food_items.map((item) => ({
          name: safeText(item?.name || ''),
          estimated_amount: safeText(item?.amount_text || item?.estimated_amount || ''),
          estimated_kcal: toNumberOrNull(item?.estimated_kcal) || 0,
          confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0.6,
          needs_confirmation: result?.meal_result?.needs_confirmation !== false,
        }))
      : [],
    confidence: Number.isFinite(Number(result?.meal_result?.confidence)) ? Number(result.meal_result.confidence) : 0.65,
    needs_confirmation: result?.meal_result?.needs_confirmation !== false,
    raw_model_json: result,
  };
}

async function applyMealCorrectionWithGemini(currentMeal = {}, correctionText = '') {
  const explicitCorrectionLabel = normalizeMealLabelText(correctionText || '');
  if (isDirectMealCorrectionText(explicitCorrectionLabel)) {
    const heuristic = buildSimpleMealHeuristic(explicitCorrectionLabel || currentMeal?.meal_label || '', currentMeal || {});
    return {
      ...currentMeal,
      is_meal: true,
      meal_label: safeText(heuristic.meal_label || explicitCorrectionLabel || currentMeal?.meal_label || ''),
      estimated_kcal: heuristic.estimated_kcal ?? currentMeal?.estimated_kcal ?? null,
      kcal_min: heuristic.kcal_min ?? currentMeal?.kcal_min ?? null,
      kcal_max: heuristic.kcal_max ?? currentMeal?.kcal_max ?? null,
      protein_g: mergeMeaningfulNumber(heuristic.protein_g, currentMeal?.protein_g),
      fat_g: mergeMeaningfulNumber(heuristic.fat_g, currentMeal?.fat_g),
      carbs_g: mergeMeaningfulNumber(heuristic.carbs_g, currentMeal?.carbs_g),
      food_items: buildDirectCorrectionFoodItems(explicitCorrectionLabel).map((item) => ({
        name: safeText(item?.name || ''),
        estimated_amount: '',
        estimated_kcal: toNumberOrNull(item?.estimated_kcal) || 0,
        confidence: 0.92,
        needs_confirmation: true,
      })),
      confidence: 0.92,
      needs_confirmation: true,
      raw_model_json: { source: 'direct_correction_heuristic' },
    };
  }

  const previousMealSummary = [
    safeText(currentMeal?.meal_label || ''),
    Array.isArray(currentMeal?.food_items)
      ? currentMeal.food_items.map((item) => safeText(item?.name || '')).filter(Boolean).join('、')
      : '',
  ].filter(Boolean).join(' / ');

  const result = await analyzeMealCorrection({ correctionText, previousMealSummary });
  const payload = result?.candidate?.parsed_payload || result?.meal_result || {};

  if (!result?.meal_result?.is_meal_related) {
    return currentMeal;
  }

  const heuristic = buildSimpleMealHeuristic(explicitCorrectionLabel || payload.meal_label || currentMeal?.meal_label || '', currentMeal || {});

  return {
    ...currentMeal,
    is_meal: true,
    meal_label: safeText(explicitCorrectionLabel || payload.meal_label || currentMeal?.meal_label || heuristic.meal_label || ''),
    estimated_kcal: toNumberOrNull(payload.estimated_kcal) ?? heuristic.estimated_kcal ?? currentMeal?.estimated_kcal ?? null,
    kcal_min: toNumberOrNull(payload.kcal_min) ?? heuristic.kcal_min ?? currentMeal?.kcal_min ?? null,
    kcal_max: toNumberOrNull(payload.kcal_max) ?? heuristic.kcal_max ?? currentMeal?.kcal_max ?? null,
    protein_g: mergeMeaningfulNumber(payload.protein_g, heuristic.protein_g ?? currentMeal?.protein_g),
    fat_g: mergeMeaningfulNumber(payload.fat_g, heuristic.fat_g ?? currentMeal?.fat_g),
    carbs_g: mergeMeaningfulNumber(payload.carbs_g, heuristic.carbs_g ?? currentMeal?.carbs_g),
    food_items: Array.isArray(payload.food_items) && payload.food_items.length
      ? payload.food_items.map((item) => ({
          name: safeText(item?.name || ''),
          estimated_amount: safeText(item?.amount_text || item?.estimated_amount || ''),
          estimated_kcal: toNumberOrNull(item?.estimated_kcal) || 0,
          confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0.6,
          needs_confirmation: result?.meal_result?.needs_confirmation !== false,
        }))
      : (Array.isArray(currentMeal?.food_items) ? currentMeal.food_items : buildDirectCorrectionFoodItems(explicitCorrectionLabel).map((item) => ({
          name: safeText(item?.name || ''),
          estimated_amount: '',
          estimated_kcal: toNumberOrNull(item?.estimated_kcal) || 0,
          confidence: 0.85,
          needs_confirmation: true,
        }))),
    confidence: Number.isFinite(Number(result?.meal_result?.confidence)) ? Number(result.meal_result.confidence) : 0.65,
    needs_confirmation: result?.meal_result?.needs_confirmation !== false,
    raw_model_json: result,
  };
}

module.exports = {
  buildMealAnalysisSchema,
  buildMealPrompt,
  normalizeFoodItems,
  normalizeMealResult,
  normalizeGeminiMealResult,
  buildFallbackMealLabel,
  buildMealCandidateFromResult,
  analyzeMealText,
  analyzeMealCorrection,
  analyzeMealImage,
  analyzeMealPhotoWithGemini,
  analyzeMealTextWithGemini,
  applyMealCorrectionWithGemini,
};
