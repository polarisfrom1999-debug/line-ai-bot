'use strict';

let GoogleGenAI = null;
try {
  ({ GoogleGenAI } = require('@google/genai'));
} catch (_) {
  GoogleGenAI = null;
}

const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
];

function normalizeText(value) {
  return String(value || '').trim();
}

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  if (!apiKey || !GoogleGenAI) return null;

  try {
    return new GoogleGenAI({ apiKey });
  } catch (error) {
    console.error('[gemini_image_analysis_service] getClient error:', error?.message || error);
    return null;
  }
}

function buildImagePart(imagePayload) {
  return {
    inlineData: {
      data: imagePayload.buffer.toString('base64'),
      mimeType: imagePayload.mimeType || 'image/jpeg'
    }
  };
}

function buildModelCandidates(model) {
  const seen = new Set();
  const list = [];

  for (const candidate of [model, PRIMARY_MODEL, ...FALLBACK_MODELS]) {
    const safe = normalizeText(candidate);
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    list.push(safe);
  }

  return list;
}

function extractTextFromResult(result) {
  if (!result) return '';
  if (typeof result.text === 'string') return normalizeText(result.text);

  const parts = result?.candidates?.[0]?.content?.parts || [];
  const joined = parts
    .map((part) => normalizeText(part?.text || ''))
    .filter(Boolean)
    .join('\n');

  return normalizeText(joined);
}

async function generateWithModel({ client, model, prompt, imagePayload, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await client.models.generateContent({
      model,
      contents: [
        { text: prompt },
        buildImagePart(imagePayload)
      ],
      config: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 1200
      },
      signal: controller.signal
    });

    const text = extractTextFromResult(result);
    return {
      ok: Boolean(text),
      text,
      model,
      reason: text ? null : 'empty_text'
    };
  } catch (error) {
    const reason = normalizeText(error?.message || 'analysis_error') || 'analysis_error';
    return {
      ok: false,
      text: '',
      model,
      reason
    };
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeImage({ imagePayload, prompt, model }) {
  if (!imagePayload?.buffer || !prompt) {
    return {
      ok: false,
      text: '',
      reason: 'missing_input'
    };
  }

  const client = getClient();
  if (!client) {
    return {
      ok: false,
      text: '',
      reason: 'client_unavailable'
    };
  }

  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 20000);
  const models = buildModelCandidates(model);
  let lastReason = 'analysis_error';

  for (const candidate of models) {
    const result = await generateWithModel({
      client,
      model: candidate,
      prompt,
      imagePayload,
      timeoutMs
    });

    if (result.ok) {
      return result;
    }

    lastReason = result.reason || lastReason;
  }

  console.error('[gemini_image_analysis_service] analyzeImage error:', JSON.stringify({
    reason: lastReason,
    mimeType: imagePayload?.mimeType || null,
    size: Number(imagePayload?.size || 0),
    models
  }));

  return {
    ok: false,
    text: '',
    reason: lastReason
  };
}

module.exports = {
  analyzeImage
};
