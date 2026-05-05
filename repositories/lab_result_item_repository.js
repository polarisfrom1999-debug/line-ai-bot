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

/**
 * lab_session_id のみ（正本 follow-up: user 表記ゆれ・内部ID誤渡し対策の土台）
 * @returns {{ rows: object[], error: string|null }}
 */
async function fetchRowsByLabSessionIdOnly({ labSessionId, excludeValidation }) {
  if (!supabase) return { rows: [], error: 'missing_supabase' };
  const sid = Number(labSessionId);
  if (!Number.isFinite(sid)) return { rows: [], error: 'bad_lab_session_id' };
  try {
    const q = await supabase
      .from('lab_result_items')
      .select('*')
      .eq('lab_session_id', sid)
      .order('normalized_key', { ascending: true });
    if (q?.error && isMissingColumnError(q.error, 'lab_result_items')) return { rows: [], error: null };
    if (q?.error) return { rows: [], error: normalizeText(q.error.message || String(q.error)) || 'query_error' };
    if (!Array.isArray(q.data)) return { rows: [], error: 'bad_response' };
    let rows = q.data;
    if (excludeValidation && Array.isArray(excludeValidation)) {
      rows = rows.filter((r) => !excludeValidation.includes(normalizeText(r.validation_status)));
    }
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: normalizeText(e?.message || e || 'exception') };
  }
}

/**
 * LINE user_id（lab_result_items.user_id に保存されている文字列）と一致する行を優先。
 * 一致が0件だがセッションに行がある場合はセッション全行を返す（保存は LINE ID・参照が内部IDだった場合の救済）。
 */
async function fetchBySessionForFollowup({ lineUserId, labSessionId, excludeValidation }) {
  const { rows: sessionRows, error } = await fetchRowsByLabSessionIdOnly({ labSessionId, excludeValidation });
  if (error) {
    return {
      rows: [],
      error,
      userMismatch: false,
      matchedByUserFilter: false,
      sessionRowCount: 0,
      sessionUserIdSample: [],
      sessionKeySample: []
    };
  }
  const uid = normalizeText(lineUserId);
  const sessionUserIdSample = [...new Set(sessionRows.map((r) => normalizeText(r.user_id)).filter(Boolean))].slice(0, 3);
  const sessionKeySample = sessionRows.slice(0, 12).map((r) => normalizeText(r.normalized_key));
  if (!uid) {
    return {
      rows: sessionRows,
      error: null,
      userMismatch: false,
      matchedByUserFilter: false,
      sessionRowCount: sessionRows.length,
      sessionUserIdSample,
      sessionKeySample
    };
  }
  const matched = sessionRows.filter((r) => normalizeText(r.user_id) === uid);
  if (matched.length) {
    return {
      rows: matched,
      error: null,
      userMismatch: false,
      matchedByUserFilter: true,
      sessionRowCount: sessionRows.length,
      sessionUserIdSample,
      sessionKeySample
    };
  }
  if (sessionRows.length) {
    return {
      rows: sessionRows,
      error: null,
      userMismatch: true,
      matchedByUserFilter: false,
      sessionRowCount: sessionRows.length,
      sessionUserIdSample,
      sessionKeySample
    };
  }
  return {
    rows: [],
    error: null,
    userMismatch: false,
    matchedByUserFilter: false,
    sessionRowCount: 0,
    sessionUserIdSample,
    sessionKeySample
  };
}

/** @deprecated 互換: 内部は fetchBySessionForFollowup（セッション優先） */
async function fetchBySession({ userId, labSessionId, excludeValidation }) {
  const sid = Number(labSessionId);
  if (!Number.isFinite(sid)) return [];
  const pack = await fetchBySessionForFollowup({ lineUserId: userId, labSessionId, excludeValidation });
  return pack.rows;
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
  fetchRowsByLabSessionIdOnly,
  fetchBySessionForFollowup,
  fetchBySession,
  fetchLatestByUserAndKey,
  fetchDistinctObservedDatesForSession
};
