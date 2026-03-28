services/lab_image_analysis_service.js
'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');

const TARGET_ITEMS = [
  'LDL',
  'HDL',
  '中性脂肪',
  'TG',
  'HbA1c',
  'AST',
  'ALT',
  'γ-GTP',
  'γGTP',
  'ALP',
  '尿酸',
  '血糖',
  '空腹時血糖',
  'クレアチニン',
  'eGFR',
  '尿素窒素',
  'LDH'
];

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizeGeminiText(text) {
  return normalizeText(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '');
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

function normalizeItemName(name) {
  const safe = normalizeText(name)
    .replace(/ＬＤＬ/gi, 'LDL')
    .replace(/ＨＤＬ/gi, 'HDL')
    .replace(/ＴＧ/gi, 'TG')
    .replace(/ＨｂＡ１ｃ/gi, 'HbA1c')
    .replace(/ＡＳＴ/gi, 'AST')
    .replace(/ＡＬＴ/gi, 'ALT')
    .replace(/γＧＴＰ/gi, 'γ-GTP')
    .replace(/γGTP/gi, 'γ-GTP')
    .replace(/ＧＧＴ/gi, 'γ-GTP')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^TG$/i.test(safe)) return '中性脂肪';
  if (/^空腹時血糖$/i.test(safe)) return '空腹時血糖';
  if (/^血糖$/i.test(safe)) return '血糖';
  return safe;
}

function normalizeValue(value) {
  return normalizeText(value).replace(/[^\d.\-]/g, '');
}

function normalizeUnit(unit) {
  return normalizeText(unit)
    .replace(/ｍｇ\/ｄＬ/gi, 'mg/dL')
    .replace(/％/g, '%');
}

function looksLikeTargetItem(name) {
  const safe = normalizeItemName(name);
  return TARGET_ITEMS.some((item) => safe.toUpperCase() === item.toUpperCase());
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];

  const normalized = [];
  const seen = new Set();

  for (const item of items) {
    const itemName = normalizeItemName(item?.itemName || item?.name || '');
    const value = normalizeValue(item?.value || '');
    const unit = normalizeUnit(item?.unit || '');

    if (!itemName || !value) continue;
    if (!looksLikeTargetItem(itemName)) continue;

    const key = `${itemName}:${value}:${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      itemName,
      value,
      unit
    });
  }

  return normalized;
}

function inferIsLabImage(items, examDate) {
  return Boolean((Array.isArray(items) && items.length) || normalizeText(examDate));
}

function tryHeuristicExtract(rawText) {
  const safe = sanitizeGeminiText(rawText);
  if (!safe) {
    return {
      examDate: '',
      items: []
    };
  }

  const items = [];
  const seen = new Set();

  for (const target of TARGET_ITEMS) {
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escaped}[\\s:：]*([0-9]+(?:\\.[0-9]+)?)\\s*([%a-zA-Z/]+)?`, 'i');
    const match = safe.match(regex);
    if (!match) continue;

    const itemName = normalizeItemName(target);
    const value = normalizeValue(match[1] || '');
    const unit = normalizeUnit(match[2] || '');

    if (!itemName || !value) continue;

    const key = `${itemName}:${value}:${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      itemName,
      value,
      unit
    });
  }

  let examDate = '';
  const dateMatch = safe.match(/(20\d{2})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})/);
  if (dateMatch) {
    const y = dateMatch[1];
    const m = String(dateMatch[2]).padStart(2, '0');
    const d = String(dateMatch[3]).padStart(2, '0');
    examDate = `${y}-${m}-${d}`;
  }

  return {
    examDate,
    items
  };
}

async function analyzeLabImage(imagePayload) {
  const prompt = [
    'この画像が血液検査結果なら、日付と検査項目をJSONで返してください。',
    'JSONのみを返してください。',
    '対象項目は LDL, HDL, 中性脂肪, HbA1c, AST, ALT, γ-GTP, ALP, 尿酸, 血糖, 空腹時血糖, クレアチニン, eGFR, 尿素窒素, LDH を優先してください。',
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
  if (parsed) {
    const items = normalizeItems(parsed.items);
    return {
      source: 'image',
      isLabImage: Boolean(parsed.isLabImage || inferIsLabImage(items, parsed.examDate)),
      examDate: normalizeText(parsed.examDate || ''),
      items,
      confidence: Number(parsed.confidence || 0)
    };
  }

  const heuristic = tryHeuristicExtract(result.text);

  return {
    source: 'image',
    isLabImage: inferIsLabImage(heuristic.items, heuristic.examDate),
    examDate: heuristic.examDate,
    items: heuristic.items,
    confidence: heuristic.items.length ? 0.55 : 0
  };
}

module.exports = {
  analyzeLabImage
};
