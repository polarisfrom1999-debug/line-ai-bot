use strict';

let GoogleGenAI = null;
let GoogleGenerativeAI = null;

try {
  ({ GoogleGenAI } = require('@google/genai'));
} catch (_err) {
  GoogleGenAI = null;
}

try {
  ({ GoogleGenerativeAI } = require('@google/generative-ai'));
} catch (_err) {
  GoogleGenerativeAI = null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function getGeminiApiKey() {
  return normalizeText(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ''
  );
}

function getPrimaryModel() {
  return normalizeText(process.env.GEMINI_MODEL || 'gemini-2.5-flash') || 'gemini-2.5-flash';
}

function getFallbackModel() {
  return normalizeText(process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash') || 'gemini-2.0-flash';
}

function isGeminiSdkAvailable() {
  return Boolean(GoogleGenAI || GoogleGenerativeAI);
}

function buildClient() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;

  try {
    if (GoogleGenAI) {
      return {
        sdk: 'genai',
        client: new GoogleGenAI({ apiKey }),
      };
    }

    if (GoogleGenerativeAI) {
      return {
        sdk: 'generative-ai',
        client: new GoogleGenerativeAI(apiKey),
      };
    }
  } catch (error) {
    console.error('[gemini_service] buildClient error:', error?.message || error);
  }

  return null;
}

function buildImagePart(imagePayload) {
  if (!imagePayload) return null;

  if (imagePayload.inlineData?.data) {
    return {
      inlineData: {
        data: imagePayload.inlineData.data,
        mimeType: imagePayload.inlineData.mimeType || imagePayload.mimeType || 'image/jpeg',
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
        mimeType: imagePayload.mimeType || 'image/jpeg',
      },
    };
  }

  return null;
}

function extractGeminiText(response) {
  if (!response) return '';

  if (typeof response.text === 'function') {
    return normalizeText(response.text());
  }

  if (typeof response.text === 'string') {
    return normalizeText(response.text);
  }

  if (typeof response.response?.text === 'function') {
    return normalizeText(response.response.text());
  }

  const candidateParts = response?.candidates?.[0]?.content?.parts || response?.response?.candidates?.[0]?.content?.parts || [];
  const joined = candidateParts
    .map((part) => normalizeText(part?.text || ''))
    .filter(Boolean)
    .join('\n');

  return normalizeText(joined);
}

function safeJsonParse(text, fallback = null) {
  const raw = String(text || '').trim();
  if (!raw) return fallback;

  const attempts = [];
  attempts.append = attempts.push;
  attempts.append(raw);
  attempts.append(raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim());

  const cleaned = attempts[1].replace(/,\s*([}\]])/g, '$1');
  attempts.append(cleaned);

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (_err) {
      // continue
    }
  }

  const safe = attempts[1];
  const openers = ['{', '['];
  for (let i = 0; i < safe.length; i += 1) {
    const opener = safe[i];
    if (!openers.includes(opener)) continue;
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
          const candidate = safe.slice(i, j + 1).replace(/,\s*([}\]])/g, '$1');
          try {
            return JSON.parse(candidate);
          } catch (_err) {
            break;
          }
        }
      }
    }
  }

  return fallback;
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

function buildModelCandidates(model) {
  const seen = new Set();
  const list = [];
  for (const candidate of [model, getPrimaryModel(), getFallbackModel()]) {
    const safe = normalizeText(candidate);
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    list.push(safe);
  }
  return list.length ? list : ['gemini-2.5-flash'];
}

async function callGenerateContent({ clientWrapper, model, parts, config = {} }) {
  if (!clientWrapper?.client) {
    throw new Error('Gemini client unavailable');
  }

  if (clientWrapper.sdk === 'genai') {
    return clientWrapper.client.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config,
    });
  }

  if (clientWrapper.sdk === 'generative-ai') {
    const generationConfig = {
      temperature: config.temperature,
      topP: config.topP,
      maxOutputTokens: config.maxOutputTokens,
      responseMimeType: config.responseMimeType,
    };

    const modelClient = clientWrapper.client.getGenerativeModel({
      model,
      generationConfig,
    });

    return modelClient.generateContent(parts);
  }

  throw new Error('No supported Gemini SDK found');
}

async function generateContentText({ prompt, imagePayloads = [], model, temperature = 0.2, maxOutputTokens = 1200 } = {}) {
  const clientWrapper = buildClient();
  if (!clientWrapper) {
    throw new Error('Gemini client unavailable');
  }

  const parts = [{ text: String(prompt || '') }];
  for (const payload of imagePayloads || []) {
    const imagePart = buildImagePart(payload);
    if (imagePart) parts.push(imagePart);
  }

  let lastError;
  for (const candidate of buildModelCandidates(model)) {
    try {
      const response = await retry(async () => callGenerateContent({
        clientWrapper,
        model: candidate,
        parts,
        config: { temperature, maxOutputTokens },
      }), 2, 700);

      return {
        model: candidate,
        text: extractGeminiText(response),
        raw: response,
      };
    } catch (error) {
      lastError = error;
      console.error(`⚠️ generateContentText failed on ${candidate}:`, error?.message || error);
    }
  }

  throw lastError || new Error('Gemini content text generation failed');
}

async function generateContentJson({ prompt, imagePayloads = [], schema = null, model, temperature = 0.2, maxOutputTokens = 1200 } = {}) {
  const clientWrapper = buildClient();
  if (!clientWrapper) {
    throw new Error('Gemini client unavailable');
  }

  const parts = [{ text: String(prompt || '') }];
  for (const payload of imagePayloads || []) {
    const imagePart = buildImagePart(payload);
    if (imagePart) parts.push(imagePart);
  }

  let lastError;
  for (const candidate of buildModelCandidates(model)) {
    try {
      const response = await retry(async () => callGenerateContent({
        clientWrapper,
        model: candidate,
        parts,
        config: clientWrapper.sdk === 'genai'
          ? {
              responseMimeType: 'application/json',
              responseJsonSchema: schema || undefined,
              temperature,
              maxOutputTokens,
            }
          : {
              responseMimeType: 'application/json',
              temperature,
              maxOutputTokens,
            },
      }), 2, 700);

      const parsed = safeJsonParse(extractGeminiText(response), null);
      if (parsed !== null) {
        return {
          model: candidate,
          parsed,
          raw: response,
        };
      }
      throw new Error('Gemini JSON parse failed');
    } catch (error) {
      lastError = error;
      console.error(`⚠️ generateContentJson failed on ${candidate}:`, error?.message || error);
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
  GoogleGenAI,
  GoogleGenerativeAI,
  isGeminiSdkAvailable,
  getGeminiApiKey,
  getPrimaryModel,
  getFallbackModel,
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
