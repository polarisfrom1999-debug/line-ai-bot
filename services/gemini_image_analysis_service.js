use strict';

const { dispatchGemini } = require('./gemini_dispatch_service');
const { safeJsonParse } = require('./gemini_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function defaultMealFallback(reason = 'fallback') {
  return {
    isMealImage: true,
    items: ['画像解析中'],
    estimated_nutrition: {
      kcal: 450,
      protein: 20,
      fat: 12,
      carbs: 50,
    },
    comment: reason === 'client_unavailable'
      ? 'GeminiキーまたはSDKの設定を確認してください。仮の推定で動作しています。'
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
  if (parsed && typeof parsed === 'object') return parsed;
  return null;
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

    const rawResult = await dispatchGemini({ prompt, imagePayload });

    const text = typeof rawResult === 'string'
      ? rawResult
      : normalizeText(rawResult?.text || rawResult?.raw || '');

    const parsed = rawResult?.parsed || extractObjectFromText(text);
    if (parsed && typeof parsed === 'object') {
      return { ok: true, data: parsed };
    }

    return { ok: false, data: defaultMealFallback('json_parse_failed') };
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
