'use strict';

const { genAI, extractGeminiText, safeJsonParse, retry } = require('./gemini_service');
const { getEnv } = require('../config/env');

const env = getEnv();

function normalizeText(value) {
  return String(value || '').trim();
}

function buildInlineMediaPart(mediaPayload = {}) {
  if (!Buffer.isBuffer(mediaPayload?.buffer) || !mediaPayload.buffer.length) return null;
  return {
    inlineData: {
      mimeType: mediaPayload.mimeType || 'application/octet-stream',
      data: mediaPayload.buffer.toString('base64')
    }
  };
}

function normalizeMediaPayloads(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') return [payload];
  return [];
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

async function generateStructuredMediaJson({
  prompt,
  schema,
  mediaPayloads,
  imagePayload,
  model,
  temperature = 0.18,
  maxOutputTokens = 4096,
  domain = 'generic_media'
} = {}) {
  if (!prompt || !schema) {
    throw new Error(`[gemini_dispatch:${domain}] missing_input`);
  }

  if (!genAI || !genAI.models || typeof genAI.models.generateContent !== 'function') {
    throw new Error(`[gemini_dispatch:${domain}] client_unavailable`);
  }

  const payloads = normalizeMediaPayloads(mediaPayloads && mediaPayloads.length ? mediaPayloads : imagePayload);
  const mediaParts = payloads.map(buildInlineMediaPart).filter(Boolean);
  if (!mediaParts.length) {
    throw new Error(`[gemini_dispatch:${domain}] invalid_media_part`);
  }

  const models = resolveModels(model);
  let lastError = null;

  for (const candidate of models) {
    try {
      const response = await retry(async () => genAI.models.generateContent({
        model: candidate,
        contents: [{ role: 'user', parts: [{ text: prompt }, ...mediaParts] }],
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

async function generateStructuredImageJson(options = {}) {
  return generateStructuredMediaJson({ ...options, domain: options.domain || 'generic_image' });
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
  generateStructuredMediaJson,
  generateStructuredImageJson,
  generateStructuredTextJson,
  buildInlineMediaPart,
  resolveModels
};
