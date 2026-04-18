'use strict';

const { dispatchGemini } = require('./gemini_dispatch_service');
const { safeJsonParse } = require('./gemini_service');

const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    isMealImage: { type: 'boolean' },
    confidence: { type: 'number', description: '0〜1。食事である確信度。曖昧なら0.35以下' },
    items: {
      type: 'array',
      items: { type: 'string' },
    },
    estimated_nutrition: {
      type: 'object',
      properties: {
        kcal: { type: 'number' },
        protein: { type: 'number' },
        fat: { type: 'number' },
        carbs: { type: 'number' },
      },
      required: ['kcal', 'protein', 'fat', 'carbs'],
    },
    comment: { type: 'string' },
  },
  required: ['isMealImage', 'confidence', 'items', 'estimated_nutrition', 'comment'],
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function defaultMealFallback(reason = 'fallback') {
  const busy = /503|busy|unavailable|timeout|429/i.test(String(reason || ''));
  return {
    isMealImage: true,
    confidence: 0.35,
    items: ['食事画像（仮推定）'],
    estimated_nutrition: {
      kcal: 450,
      protein: 20,
      fat: 12,
      carbs: 50,
    },
    comment: busy
      ? '今は画像解析が混み合っていたため、仮の推定でまとめました。あとで再送いただければ精度を上げられます。'
      : '一時的に自動推定モードで動作しています。',
    reason,
  };
}

function normalizePayload(payload) {
  if (!payload) return null;

  const buffer = payload.buffer || payload.data || null;
  if (!buffer) return null;

  return {
    buffer,
    mimeType: payload.mimeType || payload.mimetype || 'image/jpeg',
  };
}

function extractObjectFromText(text) {
  const parsed = safeJsonParse(text, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  return null;
}

function normalizeMealObject(raw, fallbackReason = 'normalized_fallback') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaultMealFallback(fallbackReason);
  }

  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => normalizeText(item)).filter(Boolean)
    : [];

  const estimated = raw.estimated_nutrition || {};

  const confRaw = Number(raw.confidence);
  const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0.45;

  return {
    isMealImage: raw.isMealImage !== false,
    confidence,
    items: items.length ? items : ['食事画像（仮推定）'],
    estimated_nutrition: {
      kcal: normalizeNumber(estimated.kcal, 450),
      protein: normalizeNumber(estimated.protein, 20),
      fat: normalizeNumber(estimated.fat, 12),
      carbs: normalizeNumber(estimated.carbs, 50),
    },
    comment: normalizeText(raw.comment || '') || '今日も一歩、健康に近づいていますね。',
    reason: normalizeText(raw.reason || fallbackReason),
  };
}

async function analyzeImage(arg1, arg2) {
  try {
    let payload;
    let prompt;

    if (arg1 && arg1.imagePayload) {
      payload = arg1.imagePayload;
      prompt = arg1.prompt;
    } else {
      payload = arg1;
      prompt = arg2;
    }

    const imagePayload = normalizePayload(payload);
    if (!imagePayload || !normalizeText(prompt)) {
      return { ok: false, data: defaultMealFallback('missing_input') };
    }

    const rawResult = await dispatchGemini({
      prompt,
      imagePayload,
      schema: MEAL_SCHEMA,
      temperature: 0.1,
      maxOutputTokens: 1200,
    });

    const text = typeof rawResult === 'string'
      ? rawResult
      : normalizeText(rawResult?.text || '');

    const parsed =
      rawResult?.parsed ||
      extractObjectFromText(text) ||
      extractObjectFromText(normalizeText(JSON.stringify(rawResult?.raw || '')));

    if (parsed && typeof parsed === 'object') {
      return {
        ok: true,
        data: normalizeMealObject(parsed, 'parsed'),
      };
    }

    return {
      ok: false,
      data: defaultMealFallback('json_parse_failed'),
    };
  } catch (error) {
    const message = normalizeText(error?.message || 'analysis_error') || 'analysis_error';
    console.error('解析プロセス失敗:', message);

    if (/client unavailable/i.test(message)) {
      return { ok: false, data: defaultMealFallback('client_unavailable') };
    }

    return { ok: false, data: defaultMealFallback(message) };
  }
}

module.exports = {
  analyzeImage,
};
