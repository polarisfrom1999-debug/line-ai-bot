'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');

const ITEM_ALIASES = {
  LDL: ['LDL', 'LDL(IFCC)', 'LDLコレステロール'],
  HDL: ['HDL', 'HDL(IFCC)', 'HDLコレステロール', 'HDL-コレステロール'],
  中性脂肪: ['中性脂肪', 'TG', 'TRIGLYCERIDES'],
  HbA1c: ['HBA1C', 'HB1AC', 'HbA1c', 'HbA1c(NGSP)', 'HbA1c（NGSP）'],
  AST: ['AST', 'GOT'],
  ALT: ['ALT', 'GPT'],
  'γ-GTP': ['γ-GTP', 'GGT', 'γGTP'],
  ALP: ['ALP'],
  BUN: ['BUN', '尿素窒素'],
  クレアチニン: ['CRE', 'クレアチニン', 'CREATININE'],
  eGFR: ['EGFR', 'eGFR'],
  血糖: ['血糖', 'GLU', 'GLUCOSE'],
  空腹時血糖: ['空腹時血糖'],
  WBC: ['WBC', '白血球'],
  RBC: ['RBC', '赤血球'],
  Hgb: ['HGB', 'Hb', 'ヘモグロビン'],
  Hct: ['HCT', 'ヘマトクリット'],
  PLT: ['PLT', '血小板'],
  TSH: ['TSH'],
  FT4: ['FT4', 'F-T4'],
  FT3: ['FT3', 'F-T3'],
  CPK: ['CPK'],
  LDH: ['LDH'],
};

const DATE_LABELS = ['検査日', '採血日', '受診日', '測定日', '印刷日'];
const LAB_SIGNAL_WORDS = /検査結果|血液検査|検査項目名|基準値|患者番号|HbA1c|LDL|HDL|TG|中性脂肪|クレアチニン|eGFR|甲状腺/i;

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizeGeminiText(text) {
  return normalizeText(text).replace(/```json/gi, '').replace(/```/g, '');
}

function extractJsonObject(text) {
  const safe = sanitizeGeminiText(text);
  const start = safe.indexOf('{');
  const end = safe.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(safe.slice(start, end + 1));
  } catch (_error) {
    return null;
  }
}

function toCanonicalItemName(name) {
  const safe = normalizeText(name).replace(/\s+/g, '').toUpperCase();
  for (const [canonical, aliases] of Object.entries(ITEM_ALIASES)) {
    if (aliases.some((alias) => safe.includes(String(alias).replace(/\s+/g, '').toUpperCase()))) {
      return canonical;
    }
  }
  return '';
}

function normalizeUnit(unit) {
  return normalizeText(unit)
    .replace(/ｍｇ\/ｄＬ/gi, 'mg/dL')
    .replace(/％/g, '%');
}

function normalizeFlag(flag) {
  const safe = normalizeText(flag).toUpperCase();
  return safe === 'H' || safe === 'L' ? safe : '';
}

function normalizeDateToken(token) {
  const safe = normalizeText(token);
  const match = safe.match(/(20\d{2})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}

function extractBestExamDate(text) {
  const safe = sanitizeGeminiText(text);
  for (const label of DATE_LABELS) {
    const labelRegex = new RegExp(`${label}[^\n\r]{0,20}(20\\d{2}[\\/\\-.年]\\s*\\d{1,2}[\\/\\-.月]\\s*\\d{1,2})`, 'i');
    const match = safe.match(labelRegex);
    if (match) return normalizeDateToken(match[1]);
  }
  const allDates = [...safe.matchAll(/20\d{2}[\/\-.年]\s*\d{1,2}[\/\-.月]\s*\d{1,2}/g)].map((m) => normalizeDateToken(m[0])).filter(Boolean);
  return allDates[0] || '';
}

function looksLikeLabImageText(text) {
  return LAB_SIGNAL_WORDS.test(sanitizeGeminiText(text));
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const itemName = toCanonicalItemName(item?.itemName || item?.name || '');
    if (!itemName) continue;
    const value = normalizeText(item?.value || item?.currentValue || '').replace(/[^\d.\-]/g, '');
    if (!value || /^20\d{2}$/.test(value)) continue;
    const unit = normalizeUnit(item?.unit || item?.currentUnit || '');
    const flag = normalizeFlag(item?.flag || item?.currentFlag || '');
    const key = `${itemName}:${value}:${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ itemName, value, unit, flag, history: [] });
  }
  return out;
}

function extractUnitFromLine(line) {
  const match = line.match(/(mg\/dL|g\/dL|IU\/L|U\/L|%|10\^\d+\/uL|10\*\d+\/uL|pg|fL|mEq\/L|uIU\/mL|ng\/dL|pg\/mL|μIU\/mL)/i);
  return normalizeUnit(match?.[1] || '');
}

function extractValueFromLine(line, canonical = '') {
  const cleaned = line.replace(/\b[HL]\b/g, (m) => ` ${m} `);
  const aliases = ITEM_ALIASES[canonical] || [];
  let tail = cleaned;
  for (const alias of aliases) {
    const idx = cleaned.toUpperCase().indexOf(String(alias).replace(/\s+/g, '').toUpperCase());
    if (idx >= 0) {
      tail = cleaned.slice(idx + alias.length);
      break;
    }
  }

  const matches = [...tail.matchAll(/\b([HL])?\s*(-?\d+(?:\.\d+)?)\b/g)];
  if (!matches.length) return { value: '', flag: '' };

  for (const hit of matches) {
    const value = String(hit[2] || '');
    if (!value || /^20\d{2}$/.test(value)) continue;
    if (/^\d{1,4}(?:\.\d+)?$/.test(value)) {
      return { value, flag: normalizeFlag(hit[1] || '') };
    }
  }
  return { value: '', flag: '' };
}

function tryHeuristicExtract(rawText) {
  const safe = sanitizeGeminiText(rawText);
  const examDate = extractBestExamDate(safe);
  const lines = safe.split(/\r?\n/).map((line) => normalizeText(line)).filter(Boolean);
  const items = [];
  const seen = new Set();

  for (const line of lines) {
    const canonical = toCanonicalItemName(line);
    if (!canonical) continue;
    const { value, flag } = extractValueFromLine(line, canonical);
    if (!value) continue;
    const unit = extractUnitFromLine(line);
    const key = `${canonical}:${value}:${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ itemName: canonical, value, unit, flag, history: [] });
  }

  return { examDate, items };
}

function mergeItems(preferredItems = [], fallbackItems = []) {
  const merged = new Map();
  for (const item of fallbackItems) {
    if (!merged.has(item.itemName)) merged.set(item.itemName, item);
  }
  for (const item of preferredItems) {
    if (!item?.itemName || !item?.value) continue;
    merged.set(item.itemName, item);
  }
  return [...merged.values()];
}

function inferIsLabImage(items, examDate, rawText = '') {
  const safe = sanitizeGeminiText(rawText);
  return Boolean(
    (Array.isArray(items) && items.length >= 2) ||
    (examDate && looksLikeLabImageText(safe)) ||
    looksLikeLabImageText(safe)
  );
}

async function analyzeLabImage(imagePayload) {
  const prompt = [
    'あなたは血液検査結果表の読み取り担当です。',
    '今見えている最新列だけを見てください。基準範囲や過去列は value に入れないでください。',
    '血液検査表ではない画像なら isLabImage を false にしてください。',
    'JSONのみを返してください。',
    '{',
    '  "isLabImage": true,',
    '  "examDate": "YYYY-MM-DD or empty",',
    '  "facilityName": "empty or clinic name",',
    '  "items": [',
    '    { "itemName": "HbA1c", "value": "6.8", "unit": "%", "flag": "H" }',
    '  ],',
    '  "confidence": 0.0',
    '}',
  ].join('\n');

  const result = await geminiImageAnalysisService.analyzeImage({ imagePayload, prompt });
  if (!result.ok) {
    return { source: 'image', isLabImage: false, examDate: '', items: [], confidence: 0, rawText: '' };
  }

  const parsed = extractJsonObject(result.text);
  const heuristic = tryHeuristicExtract(result.text);

  if (parsed) {
    const jsonItems = normalizeItems(parsed.items);
    const mergedItems = mergeItems(jsonItems, heuristic.items);
    const examDate = normalizeDateToken(parsed.examDate || '') || heuristic.examDate;
    return {
      source: 'image',
      isLabImage: Boolean(parsed.isLabImage || inferIsLabImage(mergedItems, examDate, result.text)),
      examDate,
      items: mergedItems,
      confidence: Number(parsed.confidence || (mergedItems.length ? 0.72 : 0.2)),
      rawText: sanitizeGeminiText(result.text),
    };
  }

  return {
    source: 'image',
    isLabImage: inferIsLabImage(heuristic.items, heuristic.examDate, result.text),
    examDate: heuristic.examDate,
    items: heuristic.items,
    confidence: heuristic.items.length ? 0.58 : 0.18,
    rawText: sanitizeGeminiText(result.text),
  };
}

module.exports = {
  analyzeLabImage,
};
