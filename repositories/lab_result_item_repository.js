'use strict';

let supabase = null;
try {
  ({ supabase } = require('../services/supabase_service'));
} catch (_e) {
  supabase = null;
}

function normalizeText(v) {
  return String(v || '').trim();
}

function isMissingColumnError(error, columnName) {
  const msg = normalizeText(error?.message || '');
  return Boolean(columnName && new RegExp(`column.*${columnName}|Could not find the '${columnName}' column`, 'i').test(msg));
}

async function deleteByLabSessionId(labSessionId) {
  if (!supabase || labSessionId == null) return { ok: false, reason: 'missing' };
  try {
    const del = await supabase.from('lab_result_items').delete().eq('lab_session_id', Number(labSessionId));
    if (del?.error) return { ok: false, reason: normalizeText(del.error.message || 'delete_failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: normalizeText(e?.message || 'delete_failed') };
  }
}

async function insertRow(row) {
  if (!supabase || !row || row.lab_session_id == null) return { ok: false, reason: 'bad_row' };
  try {
    const ins = await supabase.from('lab_result_items').insert(row).select('id').limit(1).maybeSingle();
    if (ins?.error) return { ok: false, reason: normalizeText(ins.error.message || 'insert_failed') };
    return { ok: true, id: ins?.data?.id };
  } catch (e) {
    return { ok: false, reason: normalizeText(e?.message || 'insert_failed') };
  }
}

async function fetchBySession({ userId, labSessionId, excludeValidation }) {
  if (!supabase) return [];
  const uid = normalizeText(userId);
  const sid = Number(labSessionId);
  if (!uid || !Number.isFinite(sid)) return [];
  try {
    let q = await supabase
      .from('lab_result_items')
      .select('*')
      .eq('user_id', uid)
      .eq('lab_session_id', sid)
      .order('normalized_key', { ascending: true });
    if (q?.error && isMissingColumnError(q.error, 'lab_result_items')) return [];
    if (q?.error || !Array.isArray(q.data)) return [];
    let rows = q.data;
    if (excludeValidation && Array.isArray(excludeValidation)) {
      rows = rows.filter((r) => !excludeValidation.includes(normalizeText(r.validation_status)));
    }
    return rows;
  } catch (_e) {
    return [];
  }
}

async function fetchLatestByUserAndKey({ userId, normalizedKey, limit = 5 }) {
  if (!supabase) return [];
  const uid = normalizeText(userId);
  const nk = normalizeText(normalizedKey);
  if (!uid || !nk) return [];
  try {
    const q = await supabase
      .from('lab_result_items')
      .select('*')
      .eq('user_id', uid)
      .eq('normalized_key', nk)
      .order('created_at', { ascending: false })
      .limit(Math.min(80, limit * 15));
    if (q?.error || !Array.isArray(q.data)) return [];
    const filtered = q.data.filter(
      (r) => !['rejected', 'superseded'].includes(normalizeText(r.validation_status))
    );
    return filtered.slice(0, limit);
  } catch (_e) {
    return [];
  }
}

async function fetchDistinctObservedDatesForSession({ userId, labSessionId }) {
  const rows = await fetchBySession({
    userId,
    labSessionId,
    excludeValidation: ['rejected', 'superseded']
  });
  const dates = new Map();
  for (const r of rows) {
    const st = normalizeText(r.observed_date_status);
    const key = r.observed_date ? String(r.observed_date) : `text:${normalizeText(r.observed_date_text)}`;
    if (!dates.has(key)) {
      dates.set(key, {
        observed_date: r.observed_date,
        observed_date_text: r.observed_date_text,
        observed_date_status: st || 'unknown'
      });
    }
  }
  return [...dates.values()];
}

module.exports = {
  deleteByLabSessionId,
  insertRow,
  fetchBySession,
  fetchLatestByUserAndKey,
  fetchDistinctObservedDatesForSession
};
