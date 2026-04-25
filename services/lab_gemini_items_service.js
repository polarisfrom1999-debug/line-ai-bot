'use strict';

const { KEY_TO_ITEM_NAME } = require('./lab_lab_display_names');

function normalizeText(value) {
  return String(value || '').trim();
}

function flattenReports(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.extracted_reports)) return payload.extracted_reports;
  if (Array.isArray(payload.reports)) return payload.reports;
  if (Array.isArray(payload.data) || payload.document_type || payload.documentType) return [payload];
  return [];
}

function serializeValue(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  return normalizeText(val);
}

function slugifyLabel(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\-ぁ-んァ-ヶ一-龠]/g, '')
    .slice(0, 80);
}

function normalizeYmd(value) {
  const s = normalizeText(value).replace(/\//g, '-');
  const m = s.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

function inferNormalizedKey(rawLabel = '') {
  const t = normalizeText(rawLabel).toLowerCase();
  if (!t) return '';
  if (t.includes('hemoglobin') || t.includes('血色素') || /^hb$/.test(t)) return 'hemoglobin';
  if (t.includes('中性脂肪') || t.includes('triglycerides') || /^tg$/.test(t)) return 'triglycerides_tg';
  if (t.includes('hba1c')) return 'hba1c';
  if (t.includes('ldl')) return 'ldl_cholesterol';
  if (t.includes('hdl')) return 'hdl_cholesterol';
  if (t.includes('ast') || t.includes('got')) return 'ast_got';
  if (t.includes('alt') || t.includes('gpt')) return 'alt_gpt';
  if (t.includes('cre') || t.includes('クレアチニン')) return 'creatinine';
  if (t.includes('wbc') || t.includes('白血球')) return 'wbc';
  if (t.includes('rbc') || t.includes('赤血球')) return 'rbc';
  return '';
}

function itemIdentityKey(it = {}, fallbackIndex = 0) {
  const od = normalizeYmd(it?.observedDate || it?.observed_date || it?.date || '');
  const nk = normalizeText(it?.normalizedKey || '');
  if (nk) return od ? `nk:${nk}@${od}` : `nk:${nk}`;
  const rn = normalizeText(it?.rawName || it?.label_in_image || '');
  if (rn) return od ? `raw:${rn.toLowerCase()}@${od}` : `raw:${rn.toLowerCase()}`;
  const nm = normalizeText(it?.name || '');
  if (nm) return od ? `name:${nm.toLowerCase()}@${od}` : `name:${nm.toLowerCase()}`;
  return `anon:${fallbackIndex}`;
}

/**
 * parsed_items_json 1件の最小形（value / source / rawName|name 必須。normalizedKey は暫定で空許容）
 */
function buildMinItem({
  normalizedKey,
  value,
  source,
  rawName,
  name,
  unit = '',
  flag = '',
  referenceLow = null,
  referenceHigh = null,
  confidence = null,
  status = '',
  observedDate = ''
} = {}) {
  const nk = normalizeText(String(normalizedKey || '').toLowerCase());
  const val = serializeValue(value);
  const src = normalizeText(source) || 'gemini_structured';
  let rn = normalizeText(rawName);
  let nm = normalizeText(name);
  if (!nm) nm = KEY_TO_ITEM_NAME[nk] || rn || nk;
  if (!rn) rn = nm || nk;
  if (!nm) nm = rn;
  return {
    normalizedKey: nk,
    value: val,
    source: src,
    rawName: rn,
    name: nm,
    ...(unit ? { unit: normalizeText(unit) } : {}),
    ...(flag ? { flag: normalizeText(flag) } : {}),
    ...(referenceLow != null ? { referenceLow } : {}),
    ...(referenceHigh != null ? { referenceHigh } : {}),
    ...(confidence != null ? { confidence: Number(confidence) || 0 } : {}),
    ...(status ? { status: normalizeText(status) } : {}),
    ...(normalizeYmd(observedDate) ? { observedDate: normalizeYmd(observedDate) } : {})
  };
}

/**
 * Gemini の data[] から行ベース正規化を経ずに直接最小 item を作る（正本）
 * normalized_key が無くても label_in_image + value があれば暫定 item 化する
 */
function extractPrimaryGeminiMinItems(payload) {
  const out = [];
  const seen = new Set();
  let anon = 0;
  for (const report of flattenReports(payload)) {
    const reportDateFallback = normalizeYmd(
      report?.latest_exam_date
      || report?.latestExamDate
      || report?.report_date
      || report?.reportDate
      || (Array.isArray(report?.exam_dates) ? report.exam_dates[0] : '')
      || (Array.isArray(report?.examDates) ? report.examDates[0] : '')
      || ''
    );
    for (const row of Array.isArray(report?.data) ? report.data : []) {
      const labelInImage = normalizeText(row?.label_in_image || row?.labelInImage || row?.row_label_raw || row?.rowLabelRaw || '');
      const explicitKey = normalizeText(String(row?.normalized_key || row?.normalizedKey || '').toLowerCase());
      const inferredKey = inferNormalizedKey(labelInImage);
      const nk = explicitKey || inferredKey || (labelInImage ? `raw_label:${slugifyLabel(labelInImage) || `item_${anon}`}` : '');
      const val = serializeValue(row?.value);
      if (!val) continue;
      const rawName = labelInImage;
      if (!nk && !rawName) continue;
      const identity = itemIdentityKey({ normalizedKey: nk, rawName }, anon++);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const name = KEY_TO_ITEM_NAME[nk] || rawName || nk;
      const observedDate = normalizeYmd(
        row?.date
        || row?.observedDate
        || row?.observed_date
        || row?.exam_date
        || row?.examDate
        || reportDateFallback
      );
      out.push(
        buildMinItem({
          normalizedKey: nk,
          value: val,
          source: 'gemini_structured',
          rawName: rawName || name,
          name: name || rawName || nk,
          unit: row?.unit,
          flag: row?.flag,
          referenceLow: row?.reference_low ?? row?.referenceLow,
          referenceHigh: row?.reference_high ?? row?.referenceHigh,
          confidence: row?.confidence,
          status: row?.status,
          observedDate
        })
      );
    }
  }
  return out;
}

function rowNormalizeToFallbackMinItem(row) {
  if (!row?.normalizedKey) return null;
  const val = serializeValue(row?.value);
  if (!val) return null;
  const rawName = normalizeText(row?.rowLabelRaw || row?.labelInImage || '');
  const name = normalizeText(row?.itemName || '') || KEY_TO_ITEM_NAME[row.normalizedKey] || rawName || row.normalizedKey;
  return buildMinItem({
    normalizedKey: row.normalizedKey,
    value: val,
    source: 'row_fallback',
    rawName: rawName || name,
    name: name || rawName || row.normalizedKey,
    unit: row?.unit,
    flag: row?.flag,
    referenceLow: row?.referenceLow,
    referenceHigh: row?.referenceHigh,
    confidence: row?.confidence,
    status: row?.status,
    observedDate: normalizeYmd(row?.date || row?.observedDate || row?.observed_date || row?.columnHeaderRaw || '')
  });
}

function mergePrimaryAndRowFallback(primaryMinItems, normalizedRows) {
  const byKey = new Map();
  let anon = 0;
  for (const it of primaryMinItems || []) {
    const k = itemIdentityKey(it, anon++);
    byKey.set(k, { ...it });
  }
  if (!byKey.size) {
    for (const row of normalizedRows || []) {
      const it = rowNormalizeToFallbackMinItem(row);
      if (!it) continue;
      const k = itemIdentityKey(it, anon++);
      if (!byKey.has(k)) byKey.set(k, it);
    }
  } else {
    for (const row of normalizedRows || []) {
      const it = rowNormalizeToFallbackMinItem(row);
      if (!it) continue;
      const k = itemIdentityKey(it, anon++);
      if (byKey.has(k)) continue;
      byKey.set(k, it);
    }
  }
  return [...byKey.values()];
}

function minItemsToRowsForGroupRows(minItems, latestExamDate) {
  const date = normalizeText(latestExamDate || '');
  return (minItems || []).map((it) => {
    const itemName = normalizeText(it.name || KEY_TO_ITEM_NAME[it.normalizedKey] || it.rawName || it.normalizedKey);
    return {
      normalizedKey: it.normalizedKey,
      itemName,
      labelInImage: normalizeText(it.rawName || it.name || itemName),
      date,
      value: serializeValue(it.value),
      unit: normalizeText(it.unit || ''),
      referenceLow: it.referenceLow ?? null,
      referenceHigh: it.referenceHigh ?? null,
      flag: normalizeText(it.flag || ''),
      confidence: Number(it.confidence || 0) || 0,
      status: normalizeText(it.status || 'readable'),
      sourceText: serializeValue(it.value),
      rowLabelRaw: normalizeText(it.rawName || ''),
      columnHeaderRaw: normalizeText(it.observedDate || date),
      observedDate: normalizeYmd(it.observedDate || date)
    };
  });
}

/** records_count: normalizedKey があり value が空でない item 数（parsed_items_json 最小スキーマ用） */
function countQualifiedParsedItems(items) {
  return (Array.isArray(items) ? items : []).filter(
    (it) => normalizeText(it?.normalizedKey) && normalizeText(serializeValue(it?.value))
  ).length;
}

function isMinSchemaParsedItems(items) {
  if (!Array.isArray(items) || !items.length) return false;
  return items.some((x) => normalizeText(x?.normalizedKey) && (normalizeText(x?.source) || normalizeText(x?.value)));
}

/** DB 直前の配列が最小スキーマか旧 structured か legacy items かを判別して件数化 */
function countPersistableParsedRecords(parsed) {
  const arr = Array.isArray(parsed) ? parsed : [];
  if (!arr.length) return 0;
  if (arr.some((x) => normalizeText(x?.normalizedKey))) {
    return countQualifiedParsedItems(arr);
  }
  if (arr[0] && typeof arr[0] === 'object' && Array.isArray(arr[0].results)) {
    return arr.filter((b) => Array.isArray(b.results) && b.results.some((r) => normalizeText(r?.value || ''))).length;
  }
  return arr.filter((it) => normalizeText(it?.value || it?.currentValue || '')).length;
}

function countQualifiedPanelRecords(panel) {
  const structured = Array.isArray(panel?.itemsStructured) ? panel.itemsStructured : [];
  if (structured.length) {
    if (structured.some((x) => normalizeText(x?.normalizedKey))) {
      return countQualifiedParsedItems(structured);
    }
    if (structured[0] && Array.isArray(structured[0].results)) {
      return structured.filter((b) => Array.isArray(b.results) && b.results.some((r) => normalizeText(r?.value || ''))).length;
    }
  }
  const items = Array.isArray(panel?.items) ? panel.items : [];
  return items.filter((it) => normalizeText(it?.value || it?.currentValue || '')).length;
}

function rowFallbackActive(mergedMinItems, primaryCount, normalizeRowCount) {
  if (!mergedMinItems?.length) return false;
  if (primaryCount > 0) return mergedMinItems.some((x) => x.source === 'row_fallback');
  return normalizeRowCount > 0;
}

module.exports = {
  flattenReports,
  buildMinItem,
  extractPrimaryGeminiMinItems,
  mergePrimaryAndRowFallback,
  minItemsToRowsForGroupRows,
  countQualifiedParsedItems,
  countPersistableParsedRecords,
  countQualifiedPanelRecords,
  isMinSchemaParsedItems,
  rowFallbackActive,
  rowNormalizeToFallbackMinItem
};
