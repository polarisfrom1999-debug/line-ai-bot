services/gemini_image_analysis_service.js
'use strict';

/**
 * services/gemini_image_analysis_service.js
 */

let GoogleGenAI = null;
try {
  ({ GoogleGenAI } = require('@google/genai'));
} catch (_) {
  GoogleGenAI = null;
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

async function analyzeImage({ imagePayload, prompt, model }) {
  if (!imagePayload?.buffer || !prompt) {
    return { ok: false, text: '', reason: 'missing_input' };
  }

  const client = getClient();
  if (!client) {
    return { ok: false, text: '', reason: 'client_unavailable' };
  }

  const safeModel = model || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 20000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await client.models.generateContent({
      model: safeModel,
      contents: [
        { text: prompt },
        buildImagePart(imagePayload)
      ],
      config: {
        temperature: 0.2
      },
      signal: controller.signal
    });

    const text = result?.text || '';
    return {
      ok: Boolean(text),
      text,
      reason: text ? null : 'empty_text'
    };
  } catch (error) {
    console.error('[gemini_image_analysis_service] analyzeImage error:', error?.message || error);
    return { ok: false, text: '', reason: 'analysis_error' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  analyzeImage
};
