'use strict';

const classifierService = require('./lab_document_classifier_service');
const extractService = require('./lab_structured_extract_service');
const labItemAliasService = require('./lab_item_alias_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function detectPageInfo(rawText = '') {
  const safe = normalizeText(rawText);
  const m = safe.match(/(\d+)\s*\/\s*(\d+)\s*ページ?/i) || safe.match(/page\s*(\d+)\s*\/\s*(\d+)/i);
  if (!m) return { current_page: null, total_pages: null };
  return {
    current_page: Number(m[1]) || null,
    total_pages: Number(m[2]) || null,
  };
}

function normalizeFlag(value) {
  const safe = normalizeText(value).toUpperCase();
  if (safe === 'H' || safe === 'HIGH') return 'H';
  if (safe === 'L' || safe === 'LOW') return 'L';
  return null;
}

function parseRange(row = {}) {
  const low = row?.referenceLow;
  const high = row?.referenceHigh;
  if (low != null && high != null) return `${low}-${high}`;
  if (low != null) return `${low}-`;
  if (high != null) return `-${high}`;
  return '';
}

function buildExamDateEntries(extraction = {}, rows = []) {
  const examDates = Array.isArray(extraction?.examDates) ? extraction.examDates : [];
  const rowDateMap = new Map();
  for (const row of rows) {
    const d = classifierService.normalizeDateToken(row?.date || '');
    if (!d) continue;
    const original = normalizeText(row?.columnHeaderRaw || row?.date || d);
    if (!rowDateMap.has(d)) rowDateMap.set(d, original);
  }
  const merged = [];
  for (const d of examDates) {
    const nd = classifierService.normalizeDateToken(d);
    if (!nd) continue;
    merged.push({
      original_text: normalizeText(d) || rowDateMap.get(nd) || nd,
      normalized_date: nd
    });
  }
  for (const [d, original] of rowDateMap.entries()) {
    if (!merged.some((x) => x.normalized_date === d)) {
      merged.push({ original_text: original || d, normalized_date: d });
    }
  }
  return merged.sort((a, b) => String(a.normalized_date).localeCompare(String(b.normalized_date)));
}

function buildStructuredItems(rows = []) {
  const byName = new Map();
  for (const row of rows) {
    const nameOriginal = normalizeText(row?.rowLabelRaw || row?.labelInImage || row?.itemName || '');
    const normalizedKey = labItemAliasService.normalizeLabCanonicalKey(nameOriginal || row?.itemName || '');
    const nameNormalized = normalizedKey ? labItemAliasService.canonicalToLabel(normalizedKey) : normalizeText(row?.itemName || nameOriginal);
    const key = `${nameNormalized}:${nameOriginal}`;
    if (!byName.has(key)) {
      byName.set(key, {
        name_original: nameOriginal || nameNormalized || '項目',
        name_normalized: nameNormalized || nameOriginal || '項目',
        normal_range: parseRange(row),
        results: []
      });
    }
    const item = byName.get(key);
    if (!item.normal_range) item.normal_range = parseRange(row);
    const examDate = classifierService.normalizeDateToken(row?.date || '');
    const valueText = normalizeText(row?.value || '');
    if (!examDate || !valueText) continue;
    item.results.push({
      exam_date: examDate,
      value: valueText + (normalizeFlag(row?.flag) ? ` ${normalizeFlag(row?.flag)}` : ''),
      numeric_value: Number.isFinite(Number(row?.value)) ? Number(row.value) : null,
      flag: normalizeFlag(row?.flag)
    });
  }
  for (const item of byName.values()) {
    item.results.sort((a, b) => String(a.exam_date).localeCompare(String(b.exam_date)));
  }
  return [...byName.values()];
}

function mapStructuredToLegacyItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const latest = (item.results || [])[item.results.length - 1] || {};
    return {
      itemName: item.name_normalized || item.name_original || '項目',
      value: normalizeText(latest.numeric_value != null ? String(latest.numeric_value) : latest.value || ''),
      unit: '',
      flag: normalizeFlag(latest.flag),
      history: (item.results || []).map((r) => ({
        date: r.exam_date,
        value: normalizeText(r.numeric_value != null ? String(r.numeric_value) : r.value || ''),
        unit: '',
        flag: normalizeFlag(r.flag),
      }))
    };
  });
}

async function analyzeLabImageV2(imagePayload, opts = {}) {
  const classification = await classifierService.classifyLabDocument(imagePayload);
  const extraction = await extractService.extractStructuredLab(imagePayload, classification);
  const rawText = [classification?.rawText, extraction?.rawText].filter(Boolean).join('\n');
  const rows = Array.isArray(extraction?.rows) ? extraction.rows : [];
  const examDateEntries = buildExamDateEntries(extraction, rows);
  const structuredItems = buildStructuredItems(rows);
  const latestExamDate = examDateEntries[examDateEntries.length - 1]?.normalized_date || extraction?.latestExamDate || '';
  const isChatShot = classification?.documentType === 'chat_screenshot';
  const geminiSaysDocument = Boolean(classification?.isLabDocument);
  const hasStructuredRows = rows.length > 0;
  const isLabImage = Boolean((geminiSaysDocument && !isChatShot) || hasStructuredRows);
  const labLike = Boolean(isLabImage || hasStructuredRows);

  const structuredJson = extraction?.rawPayload && typeof extraction.rawPayload === 'object'
    ? extraction.rawPayload
    : null;
  const geminiRaw = {
    classifier: {
      isLabDocument: classification?.isLabDocument,
      documentType: classification?.documentType,
      confidence: classification?.confidence,
      rawText: normalizeText(classification?.rawText || ''),
    },
    extraction: {
      ok: Boolean(extraction?.ok),
      documentType: extraction?.documentType || '',
      confidence: extraction?.confidence,
      rawText: normalizeText(extraction?.rawText || ''),
      rowCount: rows.length,
    },
  };

  return {
    source: 'image',
    intakeKind: 'blood_test',
    isLabImage,
    labLike,
    patientName: normalizeText(extraction?.patientName || classification?.patientName || ''),
    facilityName: '',
    printDate: normalizeText(classifierService.normalizeDateToken(classification?.reportDate || '')),
    pageInfo: detectPageInfo(rawText),
    examDate: latestExamDate,
    latestExamDate,
    examDates: examDateEntries.map((d) => d.normalized_date),
    examDateEntries,
    items: mapStructuredToLegacyItems(structuredItems),
    itemsStructured: structuredItems,
    rawText: normalizeText(rawText),
    rawPayload: extraction?.rawPayload || null,
    structuredJson,
    geminiRaw,
    geminiClassification: {
      isLabDocument: Boolean(classification?.isLabDocument),
      documentType: classification?.documentType || '',
      confidence: Number(classification?.confidence || 0) || 0,
    },
    analysisConfidence: {
      v2_confidence: Number(extraction?.confidence || 0) || 0,
      classifier_confidence: Number(classification?.confidence || 0) || 0,
      rows: rows.length
    },
    sourceImageId: normalizeText(opts?.sourceImageId || '')
  };
}

module.exports = {
  analyzeLabImageV2
};
