'use strict';

const { genAI, extractGeminiText, safeJsonParse, retry } = require('./gemini_service');
const { getEnv } = require('../config/env');

const env = getEnv();

function normalizeText(value) {
  return String(value || '').trim();
}

function buildImagePart(imagePayload = {}) {
  if (!Buffer.isBuffer(imagePayload?.buffer) || !imagePayload.buffer.length) return null;
  return {
    inlineData: {
      mimeType: imagePayload.mimeType || 'image/jpeg',
      data: imagePayload.buffer.toString('base64')
    }
  };
}

function resolveModels(preferred) {
  const seen = new Set();
  return [preferred, env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL, 'gemini-2.5-flash', 'gemini-2.5-flash-lite']
    .map(normalizeText)
    .filter(Boolean)
    .filter((model) => {
      if (seen.has(model)) return false;
      seen.add(model);
      return true;
    });
}

async function generateStructuredImageJson({
  prompt,
  schema,
  imagePayload,
  model,
  temperature = 0.18,
  maxOutputTokens = 4096,
  domain = 'generic_image'
} = {}) {
  if (!prompt || !schema || !imagePayload?.buffer) {
    throw new Error(`[gemini_dispatch:${domain}] missing_input`);
  }

  if (!genAI || !genAI.models || typeof genAI.models.generateContent !== 'function') {
    throw new Error(`[gemini_dispatch:${domain}] client_unavailable`);
  }

  const imagePart = buildImagePart(imagePayload);
  if (!imagePart) {
    throw new Error(`[gemini_dispatch:${domain}] invalid_image_part`);
  }

  if (!genAI || !genAI.models || typeof genAI.models.generateContent !== 'function') {
    throw new Error(`[gemini_dispatch:${domain}] client_unavailable`);
  }

  const models = resolveModels(model);
  let lastError = null;

  for (const candidate of models) {
    try {
      const response = await retry(async () => genAI.models.generateContent({
        model: candidate,
        contents: [{ role: 'user', parts: [{ text: prompt }, imagePart] }],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature,
          maxOutputTokens
        }
      }), 2, 700);

      const text = extractGeminiText(response);
      return {
        ok: true,
        model: candidate,
        text,
        json: safeJsonParse(text)
      };
    } catch (error) {
      lastError = error;
      console.error(`[gemini_dispatch:${domain}] ${candidate} failed:`, error?.message || error);
    }
  }

  throw lastError || new Error(`[gemini_dispatch:${domain}] failed`);
}

async function generateStructuredTextJson({
  prompt,
  schema,
  model,
  temperature = 0.18,
  maxOutputTokens = 4096,
  domain = 'generic_text'
} = {}) {
  if (!prompt || !schema) {
    throw new Error(`[gemini_dispatch:${domain}] missing_input`);
  }

  const models = resolveModels(model);
  let lastError = null;

  for (const candidate of models) {
    try {
      const response = await retry(async () => genAI.models.generateContent({
        model: candidate,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature,
          maxOutputTokens
        }
      }), 2, 700);

      const text = extractGeminiText(response);
      return {
        ok: true,
        model: candidate,
        text,
        json: safeJsonParse(text)
      };
    } catch (error) {
      lastError = error;
      console.error(`[gemini_dispatch:${domain}] ${candidate} failed:`, error?.message || error);
    }
  }

  throw lastError || new Error(`[gemini_dispatch:${domain}] failed`);
}

module.exports = {
  generateStructuredImageJson,
  generateStructuredTextJson,
  buildImagePart,
  resolveModels
};
