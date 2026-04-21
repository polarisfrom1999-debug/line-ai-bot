'use strict';

const geminiCore = require('./gemini_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function getGeminiClient() {
  return typeof geminiCore.buildClient === 'function'
    ? geminiCore.buildClient()
    : null;
}

function buildImagePayload(imagePayload) {
  if (!imagePayload) return null;

  if (imagePayload.inlineData?.data) {
    return {
      inlineData: imagePayload.inlineData,
      mimeType: imagePayload.inlineData.mimeType || imagePayload.mimeType || 'image/jpeg',
    };
  }

  if (Buffer.isBuffer(imagePayload.buffer)) {
    return {
      buffer: imagePayload.buffer,
      mimeType: imagePayload.mimeType || imagePayload.mimetype || 'image/jpeg',
    };
  }

  if (Buffer.isBuffer(imagePayload.data)) {
    return {
      buffer: imagePayload.data,
      mimeType: imagePayload.mimeType || imagePayload.mimetype || 'image/jpeg',
    };
  }

  if (typeof imagePayload.base64 === 'string' && imagePayload.base64) {
    return {
      base64: imagePayload.base64,
      mimeType: imagePayload.mimeType || imagePayload.mimetype || 'image/jpeg',
    };
  }

  return null;
}

async function generateTextFromImage({
  prompt,
  imagePayload,
  model,
  temperature = 0.2,
  maxOutputTokens = 1200,
} = {}) {
  const payload = buildImagePayload(imagePayload);
  if (!payload) throw new Error('Missing image payload');

  const result = await geminiCore.generateContentText({
    prompt,
    imagePayloads: [payload],
    model,
    temperature,
    maxOutputTokens,
  });

  return {
    ok: true,
    mode: 'image_text',
    model: result.model,
    text: result.text,
    raw: result.raw,
  };
}

async function generateJsonFromImage({
  prompt,
  imagePayload,
  schema,
  model,
  temperature = 0.2,
  maxOutputTokens = 1200,
} = {}) {
  const payload = buildImagePayload(imagePayload);
  if (!payload) throw new Error('Missing image payload');

  const result = await geminiCore.generateContentJson({
    prompt,
    imagePayloads: [payload],
    schema,
    model,
    temperature,
    maxOutputTokens,
  });

  return {
    ok: true,
    mode: 'image_json',
    model: result.model,
    parsed: result.parsed,
    raw: result.raw,
  };
}

/**
 * Formal contract for structured image extraction.
 * @param {Object} args
 * @param {Object} args.imagePayload
 * @param {string} args.prompt
 * @param {Object} args.schema
 * @param {string} [args.domain]
 * @param {string} [args.model]
 * @param {number} [args.temperature]
 * @param {number} [args.maxOutputTokens]
 * @returns {Promise<{ok:boolean, json:Object, text:string, model:string|null, raw:any, error?:{code:string,message:string}}>}
 */
async function generateStructuredImageJson({
  imagePayload,
  prompt,
  schema,
  domain = '',
  model,
  temperature = 0.2,
  maxOutputTokens = 1200,
} = {}) {
  try {
    const result = await generateJsonFromImage({
      prompt,
      imagePayload,
      schema,
      model,
      temperature,
      maxOutputTokens,
    });
    return {
      ok: true,
      json: result?.parsed && typeof result.parsed === 'object' ? result.parsed : {},
      text: normalizeText(JSON.stringify(result?.parsed || {})),
      model: result?.model || null,
      raw: result?.raw || null,
      domain: normalizeText(domain),
    };
  } catch (error) {
    return {
      ok: false,
      json: {},
      text: '',
      model: null,
      raw: null,
      domain: normalizeText(domain),
      error: {
        code: 'STRUCTURED_IMAGE_JSON_FAILED',
        message: normalizeText(error?.message || 'structured_image_json_failed')
      }
    };
  }
}

async function dispatchGemini(input = {}, maybeImagePart = null) {
  if (Array.isArray(input)) {
    const prompt = normalizeText(input[0]);
    const imagePayload = buildImagePayload(input[1] || maybeImagePart);
    const result = await generateTextFromImage({ prompt, imagePayload });
    return result.text;
  }

  const options = input || {};
  const {
    prompt,
    imagePayload = null,
    schema = null,
    model,
    temperature,
    maxOutputTokens,
  } = options;

  if (imagePayload && schema) {
    return generateJsonFromImage({
      prompt,
      imagePayload,
      schema,
      model,
      temperature,
      maxOutputTokens,
    });
  }

  if (imagePayload) {
    return generateTextFromImage({
      prompt,
      imagePayload,
      model,
      temperature,
      maxOutputTokens,
    });
  }

  if (schema) {
    const parsed = await geminiCore.generateJsonOnly(prompt, schema, temperature);
    return {
      ok: true,
      mode: 'text_json',
      model: model || geminiCore.getPrimaryModel?.() || null,
      parsed,
      raw: parsed,
    };
  }

  const text = await geminiCore.generateTextOnly(prompt, temperature);
  return {
    ok: true,
    mode: 'text_only',
    model: model || geminiCore.getPrimaryModel?.() || null,
    text,
    raw: text,
  };
}

module.exports = {
  getGeminiClient,
  getClient: getGeminiClient,
  generateTextOnly: geminiCore.generateTextOnly,
  generateJsonOnly: geminiCore.generateJsonOnly,
  generateTextFromImage,
  generateJsonFromImage,
  generateStructuredImageJson,
  dispatchGemini,
  default: dispatchGemini,
};
