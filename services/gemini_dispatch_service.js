'use strict';

let GoogleGenAI = null;
try {
  ({ GoogleGenAI } = require('@google/genai'));
} catch (_err) {
  GoogleGenAI = null;
}

let geminiCore = {};
try {
  geminiCore = require('./gemini_service');
} catch (_err) {
  geminiCore = {};
}

function normalizeText(value) {
  return String(value || '').trim();
}

function getGeminiClient() {
  if (typeof geminiCore.buildClient === 'function') {
    return geminiCore.buildClient();
  }

  const apiKey = normalizeText(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');
  if (!apiKey || !GoogleGenAI) return null;

  try {
    return new GoogleGenAI({ apiKey });
  } catch (error) {
    console.error('[gemini_dispatch_service] getGeminiClient error:', error?.message || error);
    return null;
  }
}

function buildImagePart(imagePayload) {
  if (!imagePayload) return null;

  if (imagePayload.inlineData?.data) {
    return {
      inlineData: {
        data: imagePayload.inlineData.data,
        mimeType: imagePayload.inlineData.mimeType || 'image/jpeg',
      },
    };
  }

  if (Buffer.isBuffer(imagePayload.buffer)) {
    return {
      inlineData: {
        data: imagePayload.buffer.toString('base64'),
        mimeType: imagePayload.mimeType || 'image/jpeg',
      },
    };
  }

  return null;
}

function buildModelCandidates(model) {
  const seen = new Set();
  const list = [];
  const primary = typeof geminiCore.getPrimaryModel === 'function'
    ? geminiCore.getPrimaryModel()
    : (process.env.GEMINI_MODEL || 'gemini-2.5-flash');
  const fallback = typeof geminiCore.getFallbackModel === 'function'
    ? geminiCore.getFallbackModel()
    : (process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash');

  for (const candidate of [model, primary, fallback]) {
    const safe = normalizeText(candidate);
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    list.push(safe);
  }

  return list.length ? list : ['gemini-2.5-flash'];
}

async function generateTextFromImage({ prompt, imagePayload, model, temperature = 0.2, maxOutputTokens = 1200 } = {}) {
  const client = getGeminiClient();
  const imagePart = buildImagePart(imagePayload);

  if (!client) throw new Error('Gemini client unavailable');
  if (!prompt || !imagePart) throw new Error('Missing prompt or image payload');

  let lastError;
  for (const candidate of buildModelCandidates(model)) {
    try {
      const response = await geminiCore.retry(async () => client.models.generateContent({
        model: candidate,
        contents: [{ role: 'user', parts: [{ text: String(prompt) }, imagePart] }],
        config: {
          temperature,
          maxOutputTokens,
        },
      }), 2, 700);

      return {
        ok: true,
        mode: 'image_text',
        model: candidate,
        text: geminiCore.extractGeminiText(response),
        raw: response,
      };
    } catch (error) {
      lastError = error;
      console.error(`⚠️ generateTextFromImage failed on ${candidate}:`, error?.message || error);
    }
  }

  throw lastError || new Error('Gemini image text generation failed');
}

async function generateJsonFromImage({ prompt, imagePayload, schema, model, temperature = 0.2, maxOutputTokens = 1200 } = {}) {
  const client = getGeminiClient();
  const imagePart = buildImagePart(imagePayload);

  if (!client) throw new Error('Gemini client unavailable');
  if (!prompt || !imagePart) throw new Error('Missing prompt or image payload');

  let lastError;
  for (const candidate of buildModelCandidates(model)) {
    try {
      const response = await geminiCore.retry(async () => client.models.generateContent({
        model: candidate,
        contents: [{ role: 'user', parts: [{ text: String(prompt) }, imagePart] }],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature,
          maxOutputTokens,
        },
      }), 2, 700);

      const parsed = geminiCore.safeJsonParse(geminiCore.extractGeminiText(response));
      if (parsed === null) throw new Error('Gemini image JSON parse failed');

      return {
        ok: true,
        mode: 'image_json',
        model: candidate,
        parsed,
        raw: response,
      };
    } catch (error) {
      lastError = error;
      console.error(`⚠️ generateJsonFromImage failed on ${candidate}:`, error?.message || error);
    }
  }

  throw lastError || new Error('Gemini image JSON generation failed');
}

async function dispatchGemini(options = {}) {
  const {
    prompt,
    imagePayload = null,
    schema = null,
    model,
    temperature,
    maxOutputTokens,
  } = options || {};

  if (imagePayload && schema) {
    return generateJsonFromImage({ prompt, imagePayload, schema, model, temperature, maxOutputTokens });
  }

  if (imagePayload) {
    return generateTextFromImage({ prompt, imagePayload, model, temperature, maxOutputTokens });
  }

  if (schema && typeof geminiCore.generateJsonOnly === 'function') {
    const parsed = await geminiCore.generateJsonOnly(prompt, schema, typeof temperature === 'number' ? temperature : 0.3);
    return { ok: true, mode: 'text_json', parsed };
  }

  if (typeof geminiCore.generateTextOnly === 'function') {
    const text = await geminiCore.generateTextOnly(prompt, typeof temperature === 'number' ? temperature : 0.7);
    return { ok: true, mode: 'text', text };
  }

  throw new Error('Gemini core functions unavailable');
}

module.exports = {
  GoogleGenAI,
  genAI: geminiCore.genAI || null,
  getGeminiClient,
  getClient: getGeminiClient,
  extractGeminiText: geminiCore.extractGeminiText,
  safeJsonParse: geminiCore.safeJsonParse,
  retry: geminiCore.retry,
  generateTextOnly: geminiCore.generateTextOnly,
  generateJsonOnly: geminiCore.generateJsonOnly,
  generateTextFromImage,
  generateJsonFromImage,
  dispatchGemini,
  default: dispatchGemini,
};
