const { GoogleGenAI } = require('@google/genai');
const { getEnv } = require('../config/env');

const env = getEnv();
const genAI = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

function extractGeminiText(response) {
  const text = response?.text;
  if (typeof text === 'function') return text();
  if (typeof text === 'string') return text;

  const candidateText = response?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || '')
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
  } catch {
    const cleaned = String(text || '')
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    return JSON.parse(cleaned);
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
  const tryModels = [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL];
  let lastError;

  for (const model of tryModels) {
    try {
      const response = await retry(async () => genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
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
  const tryModels = [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL];
  let lastError;

  for (const model of tryModels) {
    try {
      const response = await retry(async () => genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature,
        },
      }), 2, 700);

      return safeJsonParse(extractGeminiText(response));
    } catch (error) {
      lastError = error;
      console.error(`⚠️ generateJsonOnly failed on ${model}:`, error?.message || error);
    }
  }

  throw lastError || new Error('Gemini JSON generation failed');
}

module.exports = {
  genAI,
  extractGeminiText,
  safeJsonParse,
  retry,
  generateTextOnly,
  generateJsonOnly,
};