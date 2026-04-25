'use strict';

const classifierService = require('./lab_document_classifier_service');
const extractService = require('./lab_structured_extract_service');
const labItemAliasService = require('./lab_item_alias_service');
const labIngestTrace = require('./lab_ingest_trace_service');
const geminiItems = require('./lab_gemini_items_service');
const matrixExtractService = require('./lab_matrix_extract_service');

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

function buildStructuredItems(rows = [], defaultExamDate = '') {
  const fallbackDate = classifierService.normalizeDateToken(defaultExamDate || '');
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
    const examDate =
      classifierService.normalizeDateToken(row?.date || '') || fallbackDate;
    const valueText = normalizeText(row?.value || '');
    if (!valueText) continue;
    item.results.push({
      exam_date: examDate || '',
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

function rescueRowsToParsedMinItems(rows = []) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalizedKey = normalizeText(row?.normalized_key || row?.normalizedKey || '');
    const value = normalizeText(row?.value);
    if (!normalizedKey || !value) continue;
    out.push({
      normalizedKey,
      value,
      unit: normalizeText(row?.unit || ''),
      flag: normalizeFlag(row?.flag),
      confidence: Number(row?.confidence || 0) || 0,
      source: 'lab_multi_date_matrix',
      observedDate: normalizeText(row?.date || row?.observedDate || row?.observed_date || ''),
      rawName: normalizeText(row?.label_in_image || row?.rawName || row?.name || '')
    });
  }
  return out;
}

async function analyzeLabImageV2(imagePayload, opts = {}) {
  const classification = await classifierService.classifyLabDocument(imagePayload);
  const extraction = await extractService.extractStructuredLab(imagePayload, { ...classification, userId: opts.userId || '' });
  const rawText = [classification?.rawText, extraction?.rawText].filter(Boolean).join('\n');
  const rows = Array.isArray(extraction?.rows) ? extraction.rows : [];
  const structRows = Array.isArray(extraction?.rowsForStructured) && extraction.rowsForStructured.length
    ? extraction.rowsForStructured
    : rows;
  const parsedMinItems = Array.isArray(extraction?.parsedMinItems) ? extraction.parsedMinItems : [];
  let parsedMinItemsFinal = Array.isArray(parsedMinItems) ? [...parsedMinItems] : [];
  const docTypeNormalized = classifierService.normalizeDocumentType(classification?.documentType || '');
  const isMultiDateLayout = docTypeNormalized === 'multi_date_timeseries';
  if (!geminiItems.countQualifiedParsedItems(parsedMinItemsFinal) && isMultiDateLayout) {
    const rescuedText = await matrixExtractService.extractMatrixMajorRescueText(imagePayload, { userId: opts.userId || '' });
    const rescuedRows = matrixExtractService.majorRescueTextToDataRows(rescuedText);
    const rescuedMinItems = rescueRowsToParsedMinItems(rescuedRows);
    if (rescuedMinItems.length) parsedMinItemsFinal = rescuedMinItems;
  }
  const examDateEntries = buildExamDateEntries(extraction, structRows.length ? structRows : rows);
  const latestExamDate =
    examDateEntries[examDateEntries.length - 1]?.normalized_date || extraction?.latestExamDate || '';
  const structuredItems = buildStructuredItems(structRows, latestExamDate);
  const isChatShot = classification?.documentType === 'chat_screenshot';
  const geminiSaysDocument = Boolean(classification?.isLabDocument);
  const hasStructuredRows = structRows.length > 0 || parsedMinItemsFinal.length > 0;
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
      rowsForStructuredCount: structRows.length,
      primaryGeminiItems: extraction?.primaryGeminiItemCount ?? 0,
      rowFallbackUsed: Boolean(extraction?.rowFallbackUsed),
    },
  };

  const qualifiedParsed = geminiItems.countQualifiedParsedItems(parsedMinItemsFinal);
  const docLayout = docTypeNormalized === 'multi_date_timeseries'
    ? 'lab_multi_date_matrix'
    : 'lab_single_day_report';
  const out = {
    source: 'image',
    intakeKind: 'blood_test',
    isLabImage,
    labLike,
    labDocumentLayout: docLayout,
    patientName: normalizeText(extraction?.patientName || classification?.patientName || ''),
    facilityName: '',
    printDate: normalizeText(classifierService.normalizeDateToken(classification?.reportDate || '')),
    pageInfo: detectPageInfo(rawText),
    examDate: latestExamDate,
    latestExamDate,
    examDates: examDateEntries.map((d) => d.normalized_date),
    examDateEntries,
    items: mapStructuredToLegacyItems(structuredItems),
    itemsStructured: parsedMinItemsFinal.length ? parsedMinItemsFinal : structuredItems,
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
      rows: rows.length,
      rows_for_structured: structRows.length,
      primary_gemini_items: extraction?.primaryGeminiItemCount ?? 0,
      row_fallback_used: Boolean(extraction?.rowFallbackUsed),
      qualified_records_count: qualifiedParsed
    },
    sourceImageId: normalizeText(opts?.sourceImageId || '')
  };

  const legacy = mapStructuredToLegacyItems(structuredItems);
  let v2ItemChain = 'ok';
  if (structRows.length > 0 && structuredItems.length === 0) {
    v2ItemChain = 'v2_buildStructuredItems:all_rows_skipped_no_examdate_or_value';
  } else if (structuredItems.length > 0 && legacy.length === 0) {
    v2ItemChain = 'v2_mapStructuredToLegacy_returned_0';
  } else if (structRows.length === 0 && !parsedMinItemsFinal.length) {
    v2ItemChain = 'v2_extraction_rows_empty';
  } else if (legacy.length === 0 && !qualifiedParsed) {
    v2ItemChain = 'v2_no_legacy_item_values';
  } else if (parsedMinItemsFinal.length && qualifiedParsed) {
    v2ItemChain = extraction?.rowFallbackUsed ? 'v2_parsed_min_items_gemini_plus_row_fallback' : 'v2_parsed_min_items_gemini_primary';
  }
  console.info('[lab-ingest-trace] stage:items_source', {
    userId: String(opts.userId || ''),
    primary_gemini_items: extraction?.primaryGeminiItemCount ?? 0,
    row_fallback_used: Boolean(extraction?.rowFallbackUsed),
    parsed_min_keys: parsedMinItemsFinal.map((x) => x.normalizedKey).slice(0, 24)
  });
  labIngestTrace.logRecordsCountReason({
    userId: opts.userId,
    stage: 'lab_image_analysis_v2_built',
    details: {
      recordsCount: qualifiedParsed || legacy.length,
      chain: v2ItemChain,
      extractRowCount: rows.length,
      buildStructuredItemsCount: structuredItems.length,
      legacyMapItemsCount: legacy.length,
      primary_gemini_items: extraction?.primaryGeminiItemCount ?? 0,
      row_fallback_used: Boolean(extraction?.rowFallbackUsed),
      parsed_min_items_count: parsedMinItemsFinal.length
    }
  });
  return out;
}

module.exports = {
  analyzeLabImageV2
};
