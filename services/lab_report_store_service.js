'use strict';

const { supabase } = require('./supabase_service');
const labDocumentClassifierService = require('./lab_document_classifier_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function toCanonicalName(name) {
  const safe = normalizeText(name).toUpperCase();
  if (!safe) return '';
  if (safe.includes('中性脂肪') || safe === 'TG' || safe.includes('TRIGLY')) return 'TG';
  if (safe.includes('HBA1C') || safe === 'A1C' || safe.includes('HB1AC')) return 'HBA1C';
  if (safe.includes('LDL')) return 'LDL';
  if (safe.includes('HDL')) return 'HDL';
  if (safe.includes('WBC') || safe.includes('白血球')) return 'WBC';
  if (safe === 'AST' || safe === 'GOT' || safe.includes('AST')) return 'AST';
  if (safe === 'ALT' || safe === 'GPT' || safe.includes('ALT')) return 'ALT';
  if (safe.includes('GLU') || safe.includes('血糖')) return 'GLU';
  return safe;
}

function normalizeDate(value) {
  const safe = normalizeText(value);
  const m = safe.match(/(20\d{2})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function resolveStoredExamDate(panel) {
  if (!panel) return null;
  const candidates = [
    panel.latestExamDate,
    panel.examDate,
    ...(Array.isArray(panel.examDates) ? panel.examDates : []),
    panel.reportDate
  ];
  for (const c of candidates) {
    const iso = normalizeDate(c) || labDocumentClassifierService.normalizeDateToken(String(c || ''));
    if (iso) return iso;
  }
  const fromRaw = labDocumentClassifierService.extractExamDateFromBlobText(panel.rawText || '');
  return fromRaw || null;
}

function parseNumeric(value) {
  const safe = normalizeText(value).replace(/[^\d.\-]/g, '');
  if (!safe || safe === '.' || safe === '-' || safe === '-.') return null;
  const n = Number(safe);
  return Number.isFinite(n) ? n : null;
}

function parseNumericTokenFromText(value) {
  const safe = normalizeText(value);
  if (!safe) return null;
  const m = safe.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function buildRowsFromPanelItems({ reportId, userId, examDate, items = [] }) {
  const rows = [];
  for (const item of Array.isArray(items) ? items : []) {
    const canonical = toCanonicalName(item?.itemName || item?.name || '');
    if (!canonical) continue;
    const valueText = normalizeText(item?.value || item?.currentValue || '');
    if (!valueText) continue;
    rows.push({
      report_id: reportId,
      user_id: userId,
      exam_date: examDate,
      canonical_name: canonical,
      display_name: normalizeText(item?.itemName || item?.name || canonical),
      value_numeric: parseNumeric(valueText),
      value_text: valueText,
      unit: normalizeText(item?.unit || item?.currentUnit || ''),
      raw_label: normalizeText(item?.rawLabel || item?.itemName || item?.name || canonical)
    });
  }
  return rows;
}

function buildRowsFromStructuredRows({ reportId, userId, examDate, rows = [] }) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const label = normalizeText(row?.itemName || row?.labelInImage || row?.label_in_image || row?.display_name || row?.name || '');
    const canonical = toCanonicalName(label || row?.normalizedKey || row?.normalized_key || '');
    if (!canonical) continue;
    const rawValueText = normalizeText(row?.value || row?.value_text || row?.valueText || row?.value_numeric || row?.valueNumeric || '');
    const numeric = parseNumeric(rawValueText) ?? parseNumericTokenFromText(row?.sourceText || row?.source_text || '');
    if (numeric == null && !rawValueText) continue;
    const valueText = rawValueText || String(numeric);
    out.push({
      report_id: reportId,
      user_id: userId,
      exam_date: normalizeDate(row?.date || examDate) || examDate,
      canonical_name: canonical,
      display_name: label || canonical,
      value_numeric: numeric,
      value_text: valueText,
      unit: normalizeText(row?.unit || ''),
      raw_label: label || canonical
    });
  }
  return out;
}

function collectRowsFromRawPayload(panel = {}) {
  const reports = Array.isArray(panel?.rawPayload?.reports)
    ? panel.rawPayload.reports
    : (Array.isArray(panel?.rawPayload?.extracted_reports) ? panel.rawPayload.extracted_reports : []);
  const rawRows = [];
  for (const report of reports) {
    for (const row of Array.isArray(report?.data) ? report.data : []) rawRows.push(row);
  }
  return rawRows;
}

async function saveLabReport({ userId, panel, imageUrl = null }) {
  const safeUserId = normalizeText(userId);
  if (!safeUserId || !panel) return null;

  const examDate = resolveStoredExamDate(panel);
  const items = Array.isArray(panel?.items) ? panel.items : [];
  const readableCount = items.filter((item) => normalizeText(item?.value || '')).length;
  const status = readableCount > 0 ? 'parsed' : 'partial';

  let reportId = null;
  try {
    const { data, error } = await supabase
      .from('lab_reports')
      .insert({
        user_id: safeUserId,
        exam_date: examDate,
        source_type: normalizeText(panel?.source || 'image') || 'image',
        status,
        raw_text: normalizeText(panel?.rawText || ''),
        image_url: normalizeText(imageUrl || '') || null
      })
      .select('id')
      .single();
    if (error) throw error;
    reportId = data?.id || null;
  } catch (error) {
    console.warn('[lab-store] lab_reports insert failed:', error?.message || error);
    return null;
  }
  if (!reportId) return null;

  let rows = buildRowsFromPanelItems({
    reportId,
    userId: safeUserId,
    examDate,
    items
  });
  if (!rows.length) {
    rows = buildRowsFromStructuredRows({
      reportId,
      userId: safeUserId,
      examDate,
      rows: panel?.structuredRows || panel?.rawExtractedItems || []
    });
  }
  if (!rows.length) {
    rows = buildRowsFromStructuredRows({
      reportId,
      userId: safeUserId,
      examDate,
      rows: collectRowsFromRawPayload(panel)
    });
  }

  const dedup = new Map();
  for (const row of rows) {
    const key = `${row.canonical_name}:${row.exam_date || ''}:${row.value_text || ''}`;
    if (!dedup.has(key)) dedup.set(key, row);
  }
  rows = [...dedup.values()];

  if (rows.length) {
    try {
      const { error } = await supabase.from('lab_report_items').insert(rows);
      if (error) throw error;
    } catch (error) {
      console.warn('[lab-store] lab_report_items insert failed:', error?.message || error);
    }
  }

  return { id: reportId, examDate, status, itemCount: rows.length };
}

async function getLatestItemForUser(userId, canonicalName) {
  const safeUserId = normalizeText(userId);
  const safeCanonical = toCanonicalName(canonicalName);
  if (!safeUserId || !safeCanonical) return null;
  try {
    const { data, error } = await supabase
      .from('lab_report_items')
      .select('canonical_name, display_name, value_numeric, value_text, unit, exam_date, created_at')
      .eq('user_id', safeUserId)
      .eq('canonical_name', safeCanonical)
      .order('exam_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (_error) {
    return null;
  }
}

async function getLatestItemForUserOnExamDate(userId, canonicalName, examDate) {
  const safeUserId = normalizeText(userId);
  const safeCanonical = toCanonicalName(canonicalName);
  const safeExam = normalizeDate(examDate) || normalizeText(examDate);
  if (!safeUserId || !safeCanonical || !safeExam) return null;
  try {
    const { data, error } = await supabase
      .from('lab_report_items')
      .select('canonical_name, display_name, value_numeric, value_text, unit, exam_date, created_at')
      .eq('user_id', safeUserId)
      .eq('canonical_name', safeCanonical)
      .eq('exam_date', safeExam)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (_error) {
    return null;
  }
}

async function getLatestTwoItemsForUser(userId, canonicalName) {
  const safeUserId = normalizeText(userId);
  const safeCanonical = toCanonicalName(canonicalName);
  if (!safeUserId || !safeCanonical) return [];
  try {
    const { data, error } = await supabase
      .from('lab_report_items')
      .select('canonical_name, display_name, value_numeric, value_text, unit, exam_date, created_at')
      .eq('user_id', safeUserId)
      .eq('canonical_name', safeCanonical)
      .order('exam_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(2);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (_error) {
    return [];
  }
}

async function getLatestTwoExamSnapshots(userId) {
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return { dates: [], byDate: {} };
  try {
    const { data, error } = await supabase
      .from('lab_report_items')
      .select('canonical_name, display_name, value_text, value_numeric, unit, exam_date, created_at')
      .eq('user_id', safeUserId)
      .order('exam_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(240);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const dates = [...new Set(rows.map((r) => r.exam_date).filter(Boolean))].sort((a, b) => String(b).localeCompare(String(a)));
    const topDates = dates.slice(0, 2);
    const byDate = {};
    for (const d of topDates) byDate[d] = {};
    for (const row of rows) {
      const d = row.exam_date;
      if (!topDates.includes(d)) continue;
      const canon = normalizeText(row.canonical_name);
      if (!canon || byDate[d][canon]) continue;
      byDate[d][canon] = row;
    }
    return { dates: topDates, byDate };
  } catch (_error) {
    return { dates: [], byDate: {} };
  }
}

async function getRecentTrendForUser(userId, canonicalName, limit = 5) {
  const safeUserId = normalizeText(userId);
  const safeCanonical = toCanonicalName(canonicalName);
  if (!safeUserId || !safeCanonical) return [];
  try {
    const { data, error } = await supabase
      .from('lab_report_items')
      .select('canonical_name, display_name, value_numeric, value_text, unit, exam_date, created_at')
      .eq('user_id', safeUserId)
      .eq('canonical_name', safeCanonical)
      .order('exam_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(Math.max(2, Number(limit) || 5));
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (_error) {
    return [];
  }
}

module.exports = {
  toCanonicalName,
  saveLabReport,
  getLatestItemForUser,
  getLatestItemForUserOnExamDate,
  getLatestTwoItemsForUser,
  getRecentTrendForUser,
  getLatestTwoExamSnapshots,
  resolveStoredExamDate
};
