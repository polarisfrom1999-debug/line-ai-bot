'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const classifier = require('./lab_document_classifier_service');
const geminiDispatchService = require('./gemini_dispatch_service');
const { buildLabExtractPrompt } = require('./lab_extract_prompt_builder_service');

const KEY_TO_ITEM_NAME = {
  ast_got: 'AST',
  alt_gpt: 'ALT',
  gamma_gtp: 'γ-GTP',
  creatinine: 'クレアチニン',
  uric_acid: '尿酸',
  bun: '尿素窒素',
  glucose: '血糖',
  hba1c: 'HbA1c',
  triglycerides_tg: '中性脂肪',
  total_cholesterol: '総コレステロール',
  hdl_cholesterol: 'HDL',
  ldl_cholesterol: 'LDL',
  ldl_hdl_ratio: 'LDL/HDL比',
  sodium: 'ナトリウム',
  potassium: 'カリウム',
  chloride: 'クロール',
  egfr: 'eGFR',
  wbc: '白血球数',
  rbc: '赤血球数',
  hemoglobin: '血色素量',
  hematocrit: 'ヘマトクリット',
  mcv: 'MCV',
  mch: 'MCH',
  mchc: 'MCHC',
  platelets: '血小板数',
  cpk: 'CPK',
  ldh: 'LDH',
  total_protein: '総蛋白',
  bilirubin: '総ビリルビン',
  calcium: 'Ca'
};

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizeGeminiText(text) {
  return classifier.sanitizeGeminiText(text);
}

function extractJson(text) {
  const safe = sanitizeGeminiText(text);
  if (!safe) return null;
  try {
    return JSON.parse(safe);
  } catch (_error) {
    return classifier.extractJsonObject(safe);
  }
}

function normalizeNumberText(value) {
  const safe = normalizeText(value);
  if (!safe) return '';
  const extracted = safe.replace(/[^\d.\-]/g, '');
  if (!extracted || extracted === '.' || extracted === '-' || extracted === '-.') return '';
  return extracted;
}

function normalizeMaybeNumber(value) {
  const safe = normalizeNumberText(value);
  return safe ? Number(safe) : null;
}

function normalizeStatus(value) {
  const safe = normalizeText(value).toLowerCase();
  if (!safe) return 'unknown';
  if (safe.includes('read')) return 'readable';
  if (safe.includes('unclear')) return 'unclear';
  if (safe.includes('missing')) return 'missing';
  if (safe.includes('not_present')) return 'not_present';
  return 'unknown';
}

function normalizeFlag(value, numericValue, low, high) {
  const safe = normalizeText(value).toLowerCase();
  if (safe === 'h' || safe === 'high') return 'H';
  if (safe === 'l' || safe === 'low') return 'L';
  if (safe === 'normal') return '';
  if (numericValue != null && low != null && numericValue < low) return 'L';
  if (numericValue != null && high != null && numericValue > high) return 'H';
  return '';
}

function normalizeUnit(value) {
  return normalizeText(value)
    .replace(/ｍｇ\/ｄＬ/gi, 'mg/dL')
    .replace(/ｍｇ\/ｄｌ/gi, 'mg/dL')
    .replace(/％/g, '%')
    .replace(/μ/g, 'u');
}

function normalizeKey(key, label) {
  const safeKey = normalizeText(key).toLowerCase();
  if (KEY_TO_ITEM_NAME[safeKey]) return safeKey;
  const safeLabel = normalizeText(label).toLowerCase();
  if (/^got|ast/.test(safeLabel) || safeLabel.includes('ast')) return 'ast_got';
  if (/^gpt|alt/.test(safeLabel) || safeLabel.includes('alt')) return 'alt_gpt';
  if (safeLabel.includes('γ') || safeLabel.includes('gtp')) return 'gamma_gtp';
  if (safeLabel.includes('中性脂肪') || safeLabel.includes('tg') || safeLabel.includes('トリグリ')) return 'triglycerides_tg';
  if (safeLabel.includes('ldl/hdl')) return 'ldl_hdl_ratio';
  if (safeLabel.includes('ldl')) return 'ldl_cholesterol';
  if (safeLabel.includes('hdl')) return 'hdl_cholesterol';
  if (safeLabel.includes('総コレステ')) return 'total_cholesterol';
  if (safeLabel.includes('hba1c')) return 'hba1c';
  if (safeLabel.includes('クレアチニン') || safeLabel === 'cre') return 'creatinine';
  if (safeLabel.includes('egfr')) return 'egfr';
  if (safeLabel.includes('尿酸')) return 'uric_acid';
  if (safeLabel.includes('尿素窒素') || safeLabel === 'bun') return 'bun';
  if (safeLabel.includes('血糖') || safeLabel.includes('glucose')) return 'glucose';
  if (safeLabel.includes('白血球')) return 'wbc';
  if (safeLabel.includes('赤血球')) return 'rbc';
  if (safeLabel.includes('血色素')) return 'hemoglobin';
  if (safeLabel.includes('ヘマト')) return 'hematocrit';
  if (safeLabel === 'mcv') return 'mcv';
  if (safeLabel === 'mch') return 'mch';
  if (safeLabel === 'mchc') return 'mchc';
  if (safeLabel.includes('血小板')) return 'platelets';
  if (safeLabel === 'na' || safeLabel.includes('ナトリウム')) return 'sodium';
  if (safeLabel === 'k' || safeLabel.includes('カリウム')) return 'potassium';
  if (safeLabel === 'cl' || safeLabel.includes('クロール')) return 'chloride';
  if (safeLabel === 'cpk') return 'cpk';
  if (safeLabel === 'ldh') return 'ldh';
  if (safeLabel.includes('総蛋白')) return 'total_protein';
  if (safeLabel.includes('ビリルビン')) return 'bilirubin';
  if (safeLabel === 'ca') return 'calcium';
  return '';
}

function uniqueSortedDates(values) {
  return classifier.uniqueSortedDates(values);
}

function flattenReports(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.extracted_reports)) return payload.extracted_reports;
  if (Array.isArray(payload.reports)) return payload.reports;
  if (Array.isArray(payload.data) || payload.document_type || payload.documentType) return [payload];
  return [];
}

function normalizeRows(report) {
  const defaultDate = classifier.normalizeDateToken(report?.latest_exam_date || report?.latestExamDate || report?.report_date || report?.reportDate || '');
  const rows = [];
  for (const row of Array.isArray(report?.data) ? report.data : []) {
    const normalizedKey = normalizeKey(row?.normalized_key || row?.normalizedKey, row?.label_in_image || row?.labelInImage || '');
    if (!normalizedKey) continue;
    const itemName = KEY_TO_ITEM_NAME[normalizedKey];
    const date = classifier.normalizeDateToken(row?.date || defaultDate || '');
    const numericValue = normalizeMaybeNumber(row?.value);
    if (!itemName || !date || numericValue == null) continue;
    const referenceLow = normalizeMaybeNumber(row?.reference_low ?? row?.referenceLow);
    const referenceHigh = normalizeMaybeNumber(row?.reference_high ?? row?.referenceHigh);
    rows.push({
      normalizedKey,
      itemName,
      labelInImage: normalizeText(row?.label_in_image || row?.labelInImage || itemName),
      date,
      value: String(numericValue),
      unit: normalizeUnit(row?.unit || ''),
      referenceLow,
      referenceHigh,
      flag: normalizeFlag(row?.flag, numericValue, referenceLow, referenceHigh),
      confidence: Number(row?.confidence || 0) || 0,
      status: normalizeStatus(row?.status || 'readable'),
      sourceText: normalizeText(row?.source_text || row?.sourceText || row?.value || ''),
      rowLabelRaw: normalizeText(row?.row_label_raw || row?.rowLabelRaw || row?.label_in_image || row?.labelInImage || ''),
      columnHeaderRaw: normalizeText(row?.column_header_raw || row?.columnHeaderRaw || row?.date || '')
    });
  }
  return rows;
}

function groupRowsToItems(rows, latestExamDate) {
  const map = new Map();
  for (const row of rows) {
    const key = row.itemName;
    const current = map.get(key) || { itemName: key, unit: row.unit, flag: '', value: '', history: [], references: {} };
    current.unit = row.unit || current.unit;
    current.history.push({
      date: row.date,
      value: row.value,
      unit: row.unit,
      flag: row.flag,
      referenceLow: row.referenceLow,
      referenceHigh: row.referenceHigh,
      confidence: row.confidence,
      status: row.status,
      sourceText: row.sourceText,
      rowLabelRaw: row.rowLabelRaw,
      columnHeaderRaw: row.columnHeaderRaw
    });
    map.set(key, current);
  }

  const out = [];
  for (const item of map.values()) {
    const history = item.history
      .filter((row) => row.date && row.value)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const deduped = [];
    const seen = new Set();
    for (const row of history) {
      const dedupeKey = `${row.date}:${row.value}:${row.unit}:${row.flag}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      deduped.push(row);
    }
    const latest = deduped.find((row) => row.date === latestExamDate) || deduped[deduped.length - 1] || null;
    out.push({
      itemName: item.itemName,
      unit: latest?.unit || item.unit || '',
      value: latest?.value || '',
      flag: latest?.flag || '',
      referenceLow: latest?.referenceLow ?? null,
      referenceHigh: latest?.referenceHigh ?? null,
      history: deduped
    });
  }

  return out.sort((a, b) => a.itemName.localeCompare(b.itemName, 'ja'));
}

async function extractStructuredLab(imagePayload, meta = {}) {
  const builder = buildLabExtractPrompt(meta);
  let payload = {};
  let rawText = '';
  let ok = false;

  try {
    const dispatch = await geminiDispatchService.generateStructuredImageJson({
      imagePayload,
      prompt: builder.prompt,
      schema: builder.schema,
      domain: builder.domain,
      model: builder.preferredModel,
      temperature: builder.temperature
    });
    ok = Boolean(dispatch?.ok);
    payload = dispatch?.json || {};
    rawText = sanitizeGeminiText(dispatch?.text || '');
  } catch (dispatchError) {
    console.error('[lab_structured_extract_service] builder dispatch failed:', dispatchError?.message || dispatchError);
    const result = await geminiImageAnalysisService.analyzeImage({
      imagePayload,
      prompt: builder.prompt,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
    });
    ok = Boolean(result?.ok);
    rawText = sanitizeGeminiText(result?.text || '');
    payload = extractJson(result?.text || '') || {};
  }

  const reports = flattenReports(payload);
  const report = reports[0] || payload || {};
  const documentType = classifier.normalizeDocumentType(report.document_type || report.documentType || meta.documentType || '');
  const reportDate = classifier.normalizeDateToken(report.report_date || report.reportDate || meta.reportDate || '');
  const patientName = normalizeText(report.patient_name || report.patientName || meta.patientName || '');
  const rows = normalizeRows(report);
  const historyDates = uniqueSortedDates(rows.map((row) => row.date));
  let examDates = uniqueSortedDates([...(report.exam_dates || report.examDates || []), ...historyDates, ...(meta.examDates || [])]);
  if (!examDates.length && reportDate) examDates = [reportDate];
  const latestExamDate = classifier.normalizeDateToken(report.latest_exam_date || report.latestExamDate || meta.latestExamDate || '') || examDates[examDates.length - 1] || reportDate || '';
  const issues = [
    ...(Array.isArray(meta.issues) ? meta.issues : []),
    ...(Array.isArray(report.issues) ? report.issues : []),
    ...(Array.isArray(payload.issues) ? payload.issues : [])
  ].map(normalizeText).filter(Boolean);
  const items = groupRowsToItems(rows, latestExamDate);
  const confidenceValues = rows.map((row) => Number(row.confidence || 0)).filter((v) => v > 0);
  const confidence = confidenceValues.length
    ? Math.round((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length) * 100) / 100
    : (Number(report.confidence || payload.confidence || meta.confidence || 0) || 0);

  return {
    ok,
    documentType,
    reportDate,
    latestExamDate,
    examDates,
    patientName,
    rows,
    items,
    issues,
    confidence,
    rawText,
    rawPayload: payload,
    promptVersion: builder.promptVersion
  };
}

module.exports = {
  extractStructuredLab,
  KEY_TO_ITEM_NAME
};
