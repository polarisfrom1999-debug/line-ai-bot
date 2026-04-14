'use strict';

let GoogleGenAI = null;
try {
  ({ GoogleGenAI } = require('@google/genai'));
} catch (_err) {
  GoogleGenAI = null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function getGeminiApiKey() {
  return normalizeText(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');
}

function getPrimaryModel() {
  return normalizeText(process.env.GEMINI_MODEL || 'gemini-2.5-flash') || 'gemini-2.5-flash';
}

function getFallbackModel() {
  return normalizeText(process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash') || 'gemini-2.0-flash';
}

function isGeminiSdkAvailable() {
  return Boolean(GoogleGenAI);
}

function buildClient() {
  const apiKey = getGeminiApiKey();
  if (!apiKey || !GoogleGenAI) return null;

  try {
    return new GoogleGenAI({ apiKey });
  } catch (error) {
    console.error('[gemini_service] buildClient error:', error?.message || error);
    return null;
  }
}

const genAI = buildClient();

function ensureGeminiReady() {
  if (!GoogleGenAI) {
    throw new Error('Gemini SDK unavailable: @google/genai is not installed');
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key unavailable: GEMINI_API_KEY is missing');
  }

  const client = genAI || buildClient();
  if (!client) {
    throw new Error('Gemini client initialization failed');
  }

  return client;
}

function extractGeminiText(response) {
  const text = response?.text;
  if (typeof text === 'function') return text();
  if (typeof text === 'string') return text;

  const candidateText = response?.candidates?.[0]?.content?.parts
    ?.map((p) => p?.text || '')
    .join('')
    .trim();

  if (!candidateText) {
    throw new Error('Gemini response text not found');
  }

  return candidateText;
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    try {
      const cleaned = String(text || '')
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();

      return JSON.parse(cleaned);
    } catch (_err2) {
      return fallback;
    }
  }
}

async function retry(fn, retries = 2, delayMs = 500) {
  let lastError;

  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === retries) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }

  throw lastError;
}

function buildModelCandidates() {
  const seen = new Set();
  const list = [];

  for (const value of [getPrimaryModel(), getFallbackModel()]) {
    const safe = normalizeText(value);
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    list.push(safe);
  }

  return list.length ? list : ['gemini-2.5-flash'];
}

async function generateTextOnly(prompt, temperature = 0.7) {
  const client = ensureGeminiReady();
  const tryModels = buildModelCandidates();
  let lastError;

  for (const model of tryModels) {
    try {
      const response = await retry(async () => client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: String(prompt || '') }] }],
        config: { temperature },
      }), 2, 700);

      return extractGeminiText(response);
    } catch (error) {
      lastError = error;
      console.error(`⚠️ generateTextOnly failed on ${model}:`, error?.message || error);
    }
  }

  throw lastError || new Error('Gemini text-only generation failed');
}

async function generateJsonOnly(prompt, schema, temperature = 0.3) {
  const client = ensureGeminiReady();
  const tryModels = buildModelCandidates();
  let lastError;

  for (const model of tryModels) {
    try {
      const response = await retry(async () => client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: String(prompt || '') }] }],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature,
        },
      }), 2, 700);

      const parsed = safeJsonParse(extractGeminiText(response));
      if (parsed !== null) return parsed;
      throw new Error('Gemini JSON parse failed');
    } catch (error) {
      lastError = error;
      console.error(`⚠️ generateJsonOnly failed on ${model}:`, error?.message || error);
    }
  }

  throw lastError || new Error('Gemini JSON generation failed');
}

module.exports = {
  genAI,
  GoogleGenAI,
  isGeminiSdkAvailable,
  getGeminiApiKey,
  getPrimaryModel,
  getFallbackModel,
  buildClient,
  extractGeminiText,
  safeJsonParse,
  retry,
  generateTextOnly,
  generateJsonOnly,
};
