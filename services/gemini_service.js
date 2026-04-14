'use strict';

let GoogleGenAI = null;
try {
  ({ GoogleGenAI } = require('@google/genai'));
} catch (_err) {
  GoogleGenAI = null;
}

const { getEnv } = require('../config/env');

function safeEnv() {
  try {
    return getEnv();
  } catch (_err) {
    return process.env || {};
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

function getApiKey() {
  const env = safeEnv();
  return normalizeText(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');
}

function getPrimaryModel() {
  const env = safeEnv();
  return normalizeText(env.GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash');
}

function getFallbackModel() {
  const env = safeEnv();
  return normalizeText(env.GEMINI_FALLBACK_MODEL || process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash');
}

function buildClient() {
  const apiKey = getApiKey();
  if (!apiKey || !GoogleGenAI) return null;

  try {
    return new GoogleGenAI({ apiKey });
  } catch (error) {
    console.error('[gemini_service] buildClient error:', error?.message || error);
    return null;
  }
}

const genAI = buildClient();

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

function safeJsonParse(text) {
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
      return null;
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

async function generateTextOnly(prompt, temperature = 0.7) {
  const client = buildClient();
  if (!client) throw new Error('Gemini client unavailable');

  const tryModels = [getPrimaryModel(), getFallbackModel()].filter(Boolean);
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
  const client = buildClient();
  if (!client) throw new Error('Gemini client unavailable');

  const tryModels = [getPrimaryModel(), getFallbackModel()].filter(Boolean);
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
      if (parsed === null) throw new Error('Gemini JSON parse failed');
      return parsed;
    } catch (error) {
      lastError = error;
      console.error(`⚠️ generateJsonOnly failed on ${model}:`, error?.message || error);
    }
  }

  throw lastError || new Error('Gemini JSON generation failed');
}

module.exports = {
  GoogleGenAI,
  genAI,
  buildClient,
  getPrimaryModel,
  getFallbackModel,
  getApiKey,
  extractGeminiText,
  safeJsonParse,
  retry,
  generateTextOnly,
  generateJsonOnly,
};
