'use strict';

const { supabase } = require('./supabase_service');

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

function parseNumeric(value) {
  const safe = normalizeText(value).replace(/[^\d.\-]/g, '');
  if (!safe || safe === '.' || safe === '-' || safe === '-.') return null;
  const n = Number(safe);
  return Number.isFinite(n) ? n : null;
}

async function saveLabReport({ userId, panel, imageUrl = null }) {
  const safeUserId = normalizeText(userId);
  if (!safeUserId || !panel) return null;

  const examDate = normalizeDate(panel?.latestExamDate || panel?.examDate || panel?.reportDate || null);
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
  } catch (_error) {
    return null;
  }
  if (!reportId) return null;

  const rows = [];
  for (const item of items) {
    const canonical = toCanonicalName(item?.itemName || item?.name || '');
    if (!canonical) continue;
    const valueText = normalizeText(item?.value || item?.currentValue || '');
    if (!valueText) continue;
    rows.push({
      report_id: reportId,
      user_id: safeUserId,
      exam_date: examDate,
      canonical_name: canonical,
      display_name: normalizeText(item?.itemName || item?.name || canonical),
      value_numeric: parseNumeric(valueText),
      value_text: valueText,
      unit: normalizeText(item?.unit || item?.currentUnit || ''),
      raw_label: normalizeText(item?.rawLabel || item?.itemName || item?.name || canonical)
    });
  }

  if (rows.length) {
    try {
      const { error } = await supabase.from('lab_report_items').insert(rows);
      if (error) throw error;
    } catch (_error) {}
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
  getLatestTwoItemsForUser,
  getRecentTrendForUser
};
