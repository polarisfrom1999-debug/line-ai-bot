'use strict';

const axios = require('axios');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 45000);

function normalizeText(value) {
  return String(value || '').trim();
}

function getGeminiApiKey() {
  return normalizeText(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');
}

function getPrimaryModel() {
  return normalizeText(process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite') || 'gemini-2.5-flash-lite';
}

function getFallbackModel() {
  return normalizeText(process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash') || 'gemini-2.5-flash';
}

function getThirdModel() {
  return normalizeText(process.env.GEMINI_SECOND_FALLBACK_MODEL || '');
}

function isGeminiSdkAvailable() {
  return true;
}

function buildClient() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;

  return {
    transport: 'rest',
    apiKey,
    baseUrl: GEMINI_BASE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

function buildImagePart(imagePayload) {
  if (!imagePayload) return null;

  if (imagePayload.inlineData?.data) {
    return {
      inlineData: {
        data: String(imagePayload.inlineData.data),
        mimeType: imagePayload.inlineData.mimeType || imagePayload.mimeType || 'image/jpeg',
      },
    };
  }

  if (Buffer.isBuffer(imagePayload.buffer)) {
    return {
      inlineData: {
        data: imagePayload.buffer.toString('base64'),
        mimeType: imagePayload.mimeType || imagePayload.mimetype || 'image/jpeg',
      },
    };
  }

  if (Buffer.isBuffer(imagePayload.data)) {
    return {
      inlineData: {
        data: imagePayload.data.toString('base64'),
        mimeType: imagePayload.mimeType || imagePayload.mimetype || 'image/jpeg',
      },
    };
  }

  if (typeof imagePayload.base64 === 'string' && imagePayload.base64) {
    return {
      inlineData: {
        data: imagePayload.base64,
        mimeType: imagePayload.mimeType || imagePayload.mimetype || 'image/jpeg',
      },
    };
  }

  return null;
}

function extractGeminiText(response) {
  if (!response) return '';

  if (typeof response === 'string') {
    return normalizeText(response);
  }

  if (typeof response.text === 'string') {
    return normalizeText(response.text);
  }

  const body = response.data || response;
  const parts = body?.candidates?.[0]?.content?.parts || [];
  const joined = parts
    .map((part) => normalizeText(part?.text || ''))
    .filter(Boolean)
    .join('\n');

  return normalizeText(joined);
}

function stripCodeFence(text) {
  return normalizeText(text)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function extractBalancedJsonCandidates(text) {
  const safe = stripCodeFence(text);
  const candidates = [];

  for (let i = 0; i < safe.length; i += 1) {
    const opener = safe[i];
    if (opener !== '{' && opener !== '[') continue;

    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let j = i; j < safe.length; j += 1) {
      const ch = safe[j];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === opener) depth += 1;
      if (ch === closer) {
        depth -= 1;
        if (depth === 0) {
          candidates.push(safe.slice(i, j + 1));
          break;
        }
      }
    }
  }

  return [...new Set(candidates)].sort((a, b) => b.length - a.length);
}

function safeJsonParse(text, fallback = null) {
  const raw = normalizeText(text);
  if (!raw) return fallback;

  const attempts = [
    raw,
    stripCodeFence(raw),
    stripCodeFence(raw).replace(/,\s*([}\]])/g, '$1'),
    ...extractBalancedJsonCandidates(raw),
    ...extractBalancedJsonCandidates(raw).map((candidate) => candidate.replace(/,\s*([}\]])/g, '$1')),
  ];

  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch (_err) {
      // continue
    }
  }

  return fallback;
}

function extractStatusCode(error) {
  return Number(error?.response?.status || 0);
}

function extractApiErrorMessage(error) {
  const status = extractStatusCode(error);
  const detail =
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    'Gemini request failed';

  return status ? `[${status}] ${detail}` : String(detail);
}

function isRetryableError(error) {
  const status = extractStatusCode(error);
  if ([429, 500, 502, 503, 504].includes(status)) return true;

  const message = normalizeText(error?.message || '').toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('temporarily unavailable')
  );
}

async function retry(fn, retries = 2, delayMs = 1200) {
  let lastError;

  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === retries || !isRetryableError(error)) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }

  throw lastError;
}

function normalizeModelName(modelName) {
  return normalizeText(modelName).replace(/^models\//i, '');
}

function isRetiredModel(modelName) {
  const safe = normalizeModelName(modelName).toLowerCase();
  return [
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-lite-001',
  ].includes(safe);
}

function buildModelCandidates(model) {
  const seen = new Set();
  const list = [];

  for (const candidate of [model, getPrimaryModel(), getFallbackModel(), getThirdModel()]) {
    const safe = normalizeModelName(candidate);
    if (!safe || seen.has(safe) || isRetiredModel(safe)) continue;
    seen.add(safe);
    list.push(safe);
  }

  return list.length ? list : ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
}

function buildParts(prompt, imagePayloads = []) {
  const parts = [{ text: String(prompt || '') }];

  for (const payload of imagePayloads || []) {
    const imagePart = buildImagePart(payload);
    if (imagePart) parts.push(imagePart);
  }

  return parts;
}

async function callGenerateContent({ clientWrapper, model, parts, generationConfig = {} }) {
  if (!clientWrapper?.apiKey) {
    throw new Error('Gemini client unavailable');
  }

  const targetModel = normalizeModelName(model);
  const url = `${clientWrapper.baseUrl}/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(clientWrapper.apiKey)}`;

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig,
  };

  const response = await axios.post(url, body, {
    timeout: clientWrapper.timeoutMs,
    headers: { 'Content-Type': 'application/json' },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: (status) => status >= 200 && status < 300,
  });

  return response.data;
}

async function generateContentText({
  prompt,
  imagePayloads = [],
  model,
  temperature = 0.2,
  maxOutputTokens = 1200,
} = {}) {
  const clientWrapper = buildClient();
  if (!clientWrapper) {
    throw new Error('Gemini client unavailable');
  }

  const parts = buildParts(prompt, imagePayloads);
  let lastError = null;

  for (const candidate of buildModelCandidates(model)) {
    try {
      const response = await retry(
        () =>
          callGenerateContent({
            clientWrapper,
            model: candidate,
            parts,
            generationConfig: {
              temperature,
              maxOutputTokens,
            },
          }),
        2,
        1500
      );

      const text = extractGeminiText(response);
      if (!text) {
        throw new Error(`Empty Gemini text response on ${candidate}`);
      }

      return {
        model: candidate,
        text,
        raw: response,
      };
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ generateContentText failed on ${candidate}:`, extractApiErrorMessage(error));
      continue;
    }
  }

  throw lastError || new Error('Gemini content text generation failed');
}

async function generateContentJson({
  prompt,
  imagePayloads = [],
  schema = null,
  model,
  temperature = 0.2,
  maxOutputTokens = 1200,
} = {}) {
  const clientWrapper = buildClient();
  if (!clientWrapper) {
    throw new Error('Gemini client unavailable');
  }

  const parts = buildParts(prompt, imagePayloads);
  let lastError = null;

  for (const candidate of buildModelCandidates(model)) {
    try {
      let response;

      try {
        response = await retry(
          () =>
            callGenerateContent({
              clientWrapper,
              model: candidate,
              parts,
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: schema || undefined,
                temperature,
                maxOutputTokens,
              },
            }),
          2,
          1500
        );
      } catch (error) {
        if (extractStatusCode(error) === 400 && schema) {
          console.warn('[phasee-new] gemini_response_schema_rejected', {
            model: candidate,
            message: extractApiErrorMessage(error),
            note: 'retrying_without_responseSchema_json_unconstrained'
          });
          response = await retry(
            () =>
              callGenerateContent({
                clientWrapper,
                model: candidate,
                parts,
                generationConfig: {
                  responseMimeType: 'application/json',
                  temperature,
                  maxOutputTokens,
                },
              }),
            1,
            1000
          );
        } else {
          throw error;
        }
      }

      const parsed = safeJsonParse(extractGeminiText(response), null);
      if (parsed !== null) {
        return {
          model: candidate,
          parsed,
          raw: response,
        };
      }

      throw new Error(`Gemini JSON parse failed on ${candidate}`);
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ generateContentJson failed on ${candidate}:`, extractApiErrorMessage(error));
      continue;
    }
  }

  throw lastError || new Error('Gemini content JSON generation failed');
}

async function generateTextOnly(prompt, temperature = 0.7) {
  const result = await generateContentText({ prompt, temperature });
  return result.text;
}

async function generateJsonOnly(prompt, schema, temperature = 0.3) {
  const result = await generateContentJson({ prompt, schema, temperature });
  return result.parsed;
}

module.exports = {
  isGeminiSdkAvailable,
  getGeminiApiKey,
  getPrimaryModel,
  getFallbackModel,
  getThirdModel,
  buildClient,
  buildImagePart,
  extractGeminiText,
  safeJsonParse,
  retry,
  generateContentText,
  generateContentJson,
  generateTextOnly,
  generateJsonOnly,
};
