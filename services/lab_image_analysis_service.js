services/lab_image_analysis_service.js
'use strict';

/**
 * services/lab_image_analysis_service.js
 */

const geminiImageAnalysisService = require('./gemini_image_analysis_service');

function sanitizeGeminiText(text) {
  return String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

function extractJsonObject(text) {
  const safe = sanitizeGeminiText(text);
  const start = safe.indexOf('{');
  const end = safe.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(safe.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      itemName: String(item?.itemName || '').trim(),
      value: String(item?.value || '').trim(),
      unit: String(item?.unit || '').trim()
    }))
    .filter((item) => item.itemName && item.value);
}

async function analyzeLabImage(imagePayload) {
  const prompt = [
    'この画像が血液検査結果なら、日付と検査項目をJSONで返してください。',
    'JSONのみを返してください。',
    '{',
    '  "isLabImage": true,',
    '  "examDate": "YYYY-MM-DD または 空文字",',
    '  "items": [',
    '    { "itemName": "LDL", "value": "140", "unit": "mg/dL" }',
    '  ],',
    '  "confidence": 0.0',
    '}'
  ].join('\n');

  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt
  });

  if (!result.ok) {
    return {
      source: 'image',
      isLabImage: false,
      examDate: '',
      items: [],
      confidence: 0
    };
  }

  const parsed = extractJsonObject(result.text);
  if (!parsed) {
    return {
      source: 'image',
      isLabImage: false,
      examDate: '',
      items: [],
      confidence: 0
    };
  }

  return {
    source: 'image',
    isLabImage: Boolean(parsed.isLabImage),
    examDate: String(parsed.examDate || '').trim(),
    items: normalizeItems(parsed.items),
    confidence: Number(parsed.confidence || 0)
  };
}

module.exports = {
  analyzeLabImage
};
