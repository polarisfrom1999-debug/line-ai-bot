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

    normalized.push({ itemName, value, unit });
  }

  return normalized;
}

function inferIsLabImage(items, examDate, sourceText) {
  if (Array.isArray(items) && items.length >= 2) return true;
  if (normalizeText(examDate)) return true;
  if (/LDL|HDL|HbA1c|中性脂肪|血液検査|健診|検査結果/i.test(normalizeText(sourceText))) return true;
  return false;
}

function tryHeuristicExtract(rawText) {
  const safe = sanitizeGeminiText(rawText);
  const itemRegex = /(LDL|HDL|HbA1c|AST|ALT|LDH|γ-?GTP|TG|中性脂肪|血糖|空腹時血糖|尿酸|クレアチニン|eGFR|尿素窒素)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z%\/]+)?/g;
  const items = [];
  let match = null;

  while ((match = itemRegex.exec(safe))) {
    items.push({
      itemName: match[1],
      value: match[2],
      unit: match[3] || ''
    });
  }

  const dateMatch = safe.match(/(20\d{2}[\/\-年]\d{1,2}[\/\-月]\d{1,2}日?)/);

  return {
    examDate: dateMatch ? dateMatch[1] : '',
    items: normalizeItems(items)
  };
}

function buildPrompt() {
  return [
    'この画像が血液検査・健診結果の画像かどうかを判定してください。',
    '血液検査画像なら、主要項目だけをJSONで返してください。',
    '返答はJSONのみで、説明文は不要です。',
    '{',
    '  "isLabImage": true or false,',
    '  "examDate": "読み取れた日付。なければ空文字",',
    '  "items": [',
    '    { "itemName": "LDL", "value": "120", "unit": "mg/dL" }',
    '  ]',
    '}'
  ].join('\n');
}

async function analyzeLabImage(imagePayload) {
  if (!imagePayload?.buffer) {
    return {
      isLabImage: false,
      examDate: '',
      items: [],
      source: 'missing_image'
    };
  }

  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt: buildPrompt()
  });

  const parsed = extractJsonObject(result?.text || '');
  const heuristic = tryHeuristicExtract(result?.text || '');
  const mergedItems = normalizeItems(parsed?.items || heuristic.items || []);
  const examDate = normalizeText(parsed?.examDate || heuristic.examDate || '');
  const isLabImage = Boolean(
    parsed?.isLabImage === true || inferIsLabImage(mergedItems, examDate, result?.text || '')
  );

  return {
    isLabImage,
    examDate,
    items: mergedItems,
    rawText: normalizeText(result?.text || ''),
    source: result?.ok ? 'gemini' : (result?.reason || 'analysis_failed')
  };
}

module.exports = {
  analyzeLabImage,
  normalizeItemName
};
