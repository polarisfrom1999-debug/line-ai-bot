"use strict";

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { normalizeItemName } = require('./lab_trend_service');

const IMPORTANT_ITEMS = [
  '総コレステロール',
  'LDL',
  'HDL',
  'LDL/HDL比',
  '中性脂肪',
  'HbA1c',
  'AST',
  'ALT',
  'γ-GTP',
  'クレアチニン',
  'eGFR',
  '尿酸',
  '血糖',
  '空腹時血糖',
  'CPK',
  'LDH'
];

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizeGeminiText(text) {
  return normalizeText(text).replace(/```json/gi, '').replace(/```/g, '').trim();
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

function normalizeDateToken(token) {
  const safe = normalizeText(token);
  if (!safe) return '';

  let m = safe.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = safe.match(/(20\d{2})[\/\.年]\s*(\d{1,2})[\/\.月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;

  m = safe.match(/([0-9]{2})[\/\.\-]\s*(\d{1,2})[\/\.\-]\s*(\d{1,2})/);
  if (m) {
    const yy = Number(m[1]);
    const yyyy = yy <= 39 ? 2000 + yy : 1900 + yy;
    return `${yyyy}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  m = safe.match(/R\s*(\d+)\.(\d{1,2})\.(\d{1,2})/i);
  if (m) {
    const year = 2018 + Number(m[1]);
    return `${year}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  return '';
}

function normalizeItem(value) {
  const safe = normalizeText(value)
    .replace(/ＬＤＬ/gi, 'LDL')
    .replace(/ＨＤＬ/gi, 'HDL')
    .replace(/ＴＧ/gi, 'TG')
    .replace(/ＨｂＡ１ｃ/gi, 'HbA1c')
    .replace(/γＧＴＰ/gi, 'γ-GTP')
    .replace(/γGTP/gi, 'γ-GTP')
    .replace(/ＧＯＴ/gi, 'AST')
    .replace(/ＧＰＴ/gi, 'ALT')
    .replace(/総コレステロール|T-CHO|CHO/gi, '総コレステロール')
    .replace(/LDL\/HDL比/gi, 'LDL/HDL比')
    .replace(/中性脂肪|トリグリセリド/gi, '中性脂肪')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^TG$/i.test(safe)) return '中性脂肪';
  return normalizeItemName(safe);
}

function normalizeValue(value) {
  return normalizeText(value).replace(/[^\d.\-]/g, '');
}

function normalizeUnit(unit) {
  return normalizeText(unit)
    .replace(/ｍｇ\/ｄＬ/gi, 'mg/dL')
    .replace(/ｍｇ\/ｄｌ/gi, 'mg/dL')
    .replace(/％/g, '%')
    .replace(/μ/g, 'u');
}

function normalizeFlag(flag) {
  const safe = normalizeText(flag).toUpperCase();
  return safe === 'H' || safe === 'L' ? safe : '';
}

function uniqueSortedDates(values) {
  return [...new Set(values.map(normalizeDateToken).filter(Boolean))].sort();
}

function normalizeHistory(rows, fallbackUnit = '') {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = normalizeDateToken(row?.date || '');
    const value = normalizeValue(row?.value || '');
    if (!date || !value) continue;
    out.push({
      date,
      value,
      unit: normalizeUnit(row?.unit || fallbackUnit),
      flag: normalizeFlag(row?.flag || '')
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set();
  return out.filter((row) => {
    const key = `${row.date}:${row.value}:${row.unit}:${row.flag}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeItems(items, latestExamDate) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const itemName = normalizeItem(item?.itemName || item?.name || '');
    if (!itemName || !IMPORTANT_ITEMS.includes(itemName)) continue;

    const unit = normalizeUnit(item?.unit || item?.currentUnit || '');
    const history = normalizeHistory(item?.history, unit);
    let value = normalizeValue(item?.currentValue || item?.value || '');
    let flag = normalizeFlag(item?.currentFlag || item?.flag || '');

    if (!value && latestExamDate) {
      const latestRow = history.find((row) => row.date === latestExamDate);
      if (latestRow) {
        value = latestRow.value;
        flag = latestRow.flag;
      }
    }

    if (value && latestExamDate && !history.some((row) => row.date === latestExamDate && row.value === value)) {
      history.push({ date: latestExamDate, value, unit, flag });
    }

    const finalHistory = normalizeHistory(history, unit);
    if (!value && finalHistory.length) {
      const latestRow = finalHistory[finalHistory.length - 1];
      value = latestRow.value;
      flag = latestRow.flag;
    }

    if (!value && !finalHistory.length) continue;

    out.push({ itemName, value, unit, flag, history: finalHistory });
  }
  return out;
}

async function analyzeJsonPrompt(imagePayload, prompt) {
  const result = await geminiImageAnalysisService.analyzeImage({ imagePayload, prompt, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
  return {
    ok: Boolean(result?.ok),
    text: sanitizeGeminiText(result?.text || ''),
    raw: result || null,
    json: extractJsonObject(result?.text || '')
  };
}

function buildStructurePrompt() {
  return [
    'あなたは血液検査票の表構造を読む係です。画像が血液検査票なら JSON のみで返してください。',
    '重要: examDates には、表の結果列に対応する検査日だけを入れてください。帳票上部の発行日時や印刷日時は reportDate にだけ入れてください。',
    '複数日付が表にある時は、左から右へそのまま examDates に入れてください。',
    '単日表で結果列の日付が無い時だけ reportDate を examDates に入れてください。',
    '{',
    '  "isLabImage": true,',
    '  "documentKind": "single_panel | multi_panel | unknown",',
    '  "reportDate": "YYYY-MM-DD or empty",',
    '  "examDates": ["YYYY-MM-DD"],',
    '  "latestExamDate": "YYYY-MM-DD or empty"',
    '}'
  ].join('\n');
}

function buildValuesPrompt(examDates) {
  const dateNote = examDates.length
    ? `利用する検査日候補は ${examDates.join(', ')} です。history にはこの日付だけを使ってください。`
    : '検査日候補が不明な場合でも、見えている検査日と値を history に整理してください。';

  return [
    'あなたは血液検査票の数値を読む係です。JSON のみで返してください。',
    dateNote,
    '左側の基準値列や正常値列は value に入れないでください。結果列の値だけを使ってください。',
    '以下の固定項目を優先してください: 総コレステロール, LDL, HDL, LDL/HDL比, 中性脂肪, HbA1c, AST, ALT, γ-GTP, クレアチニン, eGFR, 尿酸, 血糖, CPK, LDH。',
    '複数日付表では各項目の history に日付ごとの値を入れてください。最新日付の値は currentValue にも入れてください。',
    '{',
    '  "isLabImage": true,',
    '  "items": [',
    '    {',
    '      "itemName": "HbA1c",',
    '      "unit": "%",',
    '      "currentValue": "5.6",',
    '      "currentFlag": "",',
    '      "history": [',
    '        { "date": "2017-04-11", "value": "5.8", "unit": "%", "flag": "" },',
    '        { "date": "2025-03-22", "value": "5.6", "unit": "%", "flag": "" }',
    '      ]',
    '    }',
    '  ],',
    '  "trendSummary": "短い要約 or empty"',
    '}'
  ].join('\n');
}

function looksLabLike(text) {
  const safe = sanitizeGeminiText(text);
  return /検査結果|血液検査|HbA1c|中性脂肪|LDL|HDL|AST|ALT|γ-GTP|クレアチニン|eGFR/.test(safe);
}

async function analyzeLabImage(imagePayload) {
  const structure = await analyzeJsonPrompt(imagePayload, buildStructurePrompt());
  const structureJson = structure.json || {};
  const structureDates = uniqueSortedDates(structureJson.examDates || []);
  const reportDate = normalizeDateToken(structureJson.reportDate || '');

  const values = await analyzeJsonPrompt(imagePayload, buildValuesPrompt(structureDates));
  const valuesJson = values.json || {};

  let latestExamDate = normalizeDateToken(structureJson.latestExamDate || '');
  let items = normalizeItems(valuesJson.items, latestExamDate);

  const historyDates = uniqueSortedDates(items.flatMap((item) => (item.history || []).map((row) => row.date)));
  let examDates = uniqueSortedDates([...(structureDates || []), ...historyDates]);

  if (reportDate && examDates.length >= 2 && !historyDates.includes(reportDate)) {
    examDates = examDates.filter((d) => d !== reportDate);
  }
  if (!examDates.length && reportDate) examDates = [reportDate];
  if (!latestExamDate) latestExamDate = examDates[examDates.length - 1] || reportDate || '';

  items = normalizeItems(valuesJson.items, latestExamDate);

  const isLabImage = Boolean(structureJson.isLabImage || valuesJson.isLabImage || items.length || looksLabLike(structure.text) || looksLabLike(values.text));
  const trendSummary = normalizeText(valuesJson.trendSummary || '');

  return {
    source: 'image',
    isLabImage,
    labLike: isLabImage,
    reportDate,
    examDate: latestExamDate,
    latestExamDate,
    examDates,
    availableDates: examDates,
    documentKind: normalizeText(structureJson.documentKind || ''),
    items,
    confidence: items.length ? 0.9 : (examDates.length ? 0.72 : 0.4),
    trendSummary,
    rawText: [structure.text, values.text].filter(Boolean).join('\n'),
    dateRawText: structure.text,
    matrixRawText: values.text
  };
}

module.exports = {
  analyzeLabImage
};
