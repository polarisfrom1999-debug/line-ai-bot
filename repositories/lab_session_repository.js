'use strict';

const labIngestTrace = require('../services/lab_ingest_trace_service');

let supabase = null;
try {
  ({ supabase } = require('../services/supabase_service'));
} catch (_error) {
  supabase = null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

/** Meta correction: strip junk before persisting patch / session columns (resolver unchanged). */
function stripLeadingPunctuationAndSpaces(s) {
  let t = String(s || '');
  for (let i = 0; i < 8; i++) {
    const next = t.replace(/^[\s\u3000、。,.．]+/, '');
    if (next === t) break;
    t = next;
  }
  return t;
}

const LAB_META_NAME_INTRO_RE =
  /^(これは|これ|ここ|ここは|この医療機関は|この病院は|病院は|施設は|医療機関は|病院名は|施設名は)\s*[、,]?\s*/u;

function sanitizeLabMetaNameField(value) {
  let s = normalizeText(value);
  if (!s) return '';
  for (let i = 0; i < 6; i++) {
    s = stripLeadingPunctuationAndSpaces(s);
    const m = s.match(LAB_META_NAME_INTRO_RE);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  s = stripLeadingPunctuationAndSpaces(s);
  s = s.replace(/[\s\u3000、。,.．]+$/u, '').trim();
  return normalizeText(s);
}

function sanitizeMetaCorrectionPatch(patch) {
  if (!patch || typeof patch !== 'object') return patch;
  const out = { ...patch };
  if (Object.prototype.hasOwnProperty.call(out, 'patientName')) {
    out.patientName = sanitizeLabMetaNameField(out.patientName);
  }
  if (Object.prototype.hasOwnProperty.call(out, 'facilityName')) {
    out.facilityName = sanitizeLabMetaNameField(out.facilityName);
  }
  return out;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

/** exam_dates_json は string[] のみ（オブジェクト行が混ざっても文字列化） */
function toExamDatesStringArray(value) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  for (const x of arr) {
    if (x == null) continue;
    if (typeof x === 'string') {
      const s = normalizeText(x);
      if (s) out.push(s);
    } else if (typeof x === 'object') {
      const s = normalizeText(x.normalized_date || x.normalizedDate || x.value || '');
      if (s) out.push(s);
    } else {
      const s = String(x).trim();
      if (s) out.push(s);
    }
  }
  return out;
}

function isMissingColumnError(error, columnName) {
  const msg = normalizeText(error?.message || '');
  return Boolean(columnName && new RegExp(`column.*${columnName}|Could not find the '${columnName}' column`, 'i').test(msg));
}

async function createLabSession(params = {}) {
  if (!supabase) return { ok: false, reason: 'missing_supabase' };
  const userId = normalizeText(params.userId);
  if (!userId) return { ok: false, reason: 'missing_user' };
  const now = new Date().toISOString();
  const baseRow = {
    user_id: userId,
    source_image_id: normalizeText(params.sourceImageId || ''),
    source_message_id: normalizeText(params.sourceMessageId || ''),
    status: normalizeText(params.status || 'tentative') || 'tentative',
    patient_name: normalizeText(params.patientName || ''),
    patient_id: normalizeText(params.patientId || ''),
    facility_name: normalizeText(params.facilityName || ''),
    print_date: normalizeText(params.printDate || '') || null,
    exam_dates_json: toExamDatesStringArray(params.examDates),
    parsed_items_json: toArray(params.parsedItems),
    raw_text: normalizeText(params.rawText || ''),
    confidence: Number(params.confidence || 0) || 0,
    is_lab_image_strict: Boolean(params.isLabImageStrict),
    is_lab_image_tentative: Boolean(params.isLabImageTentative),
    created_at: now,
    updated_at: now,
    expires_at: params.expiresAt || null,
  };
  const rowWithGemini = {
    ...baseRow,
    gemini_raw: params.geminiRaw != null ? params.geminiRaw : null,
    structured_json: params.structuredJson != null ? params.structuredJson : null,
  };
  try {
    let insertRow = rowWithGemini;
    labIngestTrace.logPreInsert({
      userId,
      insertPayload: { stage: 'supabase_row_ready', variant: 'with_gemini_raw_columns', supabaseInsertRow: insertRow }
    });
    let ins = await supabase
      .from('lab_sessions')
      .insert(insertRow)
      .select('id,user_id,status,created_at')
      .limit(1)
      .maybeSingle();
    if (ins?.error && (isMissingColumnError(ins.error, 'gemini_raw') || isMissingColumnError(ins.error, 'structured_json'))) {
      insertRow = baseRow;
      labIngestTrace.logPreInsert({
        userId,
        insertPayload: { stage: 'supabase_row_retry', variant: 'without_gemini_columns_schema_fallback', supabaseInsertRow: insertRow }
      });
      ins = await supabase
        .from('lab_sessions')
        .insert(insertRow)
        .select('id,user_id,status,created_at')
        .limit(1)
        .maybeSingle();
    }
    if (ins?.error || !ins?.data) {
      labIngestTrace.logPostInsertReadback({
        userId,
        sessionId: '',
        readRow: null,
        readError: ins?.error,
        insertError: ins?.error
      });
      return { ok: false, reason: normalizeText(ins?.error?.message || 'insert_failed') };
    }
    const sessionId = ins.data.id;
    let readBack = await supabase
      .from('lab_sessions')
      .select('id,user_id,status,patient_name,facility_name,print_date,exam_dates_json,parsed_items_json,raw_text,gemini_raw,structured_json,confidence,created_at,updated_at,expires_at,source_image_id,source_message_id')
      .eq('id', sessionId)
      .maybeSingle();
    if (readBack?.error && (isMissingColumnError(readBack.error, 'gemini_raw') || isMissingColumnError(readBack.error, 'structured_json'))) {
      readBack = await supabase
        .from('lab_sessions')
        .select('id,user_id,status,patient_name,facility_name,print_date,exam_dates_json,parsed_items_json,raw_text,confidence,created_at,updated_at,expires_at,source_image_id,source_message_id')
        .eq('id', sessionId)
        .maybeSingle();
    }
    labIngestTrace.logPostInsertReadback({
      userId,
      sessionId,
      readRow: readBack?.data || null,
      readError: readBack?.error,
      insertError: null
    });
    return { ok: true, session: ins.data };
  } catch (error) {
    labIngestTrace.logPostInsertReadback({ userId, sessionId: '', readRow: null, readError: error, insertError: error });
    return { ok: false, reason: normalizeText(error?.message || 'insert_failed') };
  }
}

function sessionRowHasUsableFollowupContent(row) {
  if (!row) return false;
  const items = row.parsed_items_json;
  if (Array.isArray(items)) {
    for (const it of items) {
      if (normalizeText(it?.normalizedKey) && normalizeText(it?.value)) return true;
    }
  }
  if (normalizeText(row.patient_name) || normalizeText(row.facility_name) || normalizeText(row.print_date)) return true;
  return false;
}

/** 低いほど follow-up で優先（ok > null/その他 > needs_manual_review）。superseded は候補から除外。 */
function validationPriorityTier(validationStatus) {
  const s = normalizeText(validationStatus).toLowerCase();
  if (!s) return 2;
  if (s === 'ok') return 1;
  if (s === 'needs_manual_review') return 3;
  if (s === 'superseded') return 99;
  return 2;
}

function resolveEffectiveLabSessionRow(row, idMap, depth = 0) {
  if (!row || depth > 14) return row || null;
  if (normalizeText(row.validation_status).toLowerCase() !== 'superseded') return row;
  const sid = row.superseded_by_session_id;
  if (sid == null || sid === '') return row;
  const next = idMap.get(Number(sid));
  if (!next || next === row) return row;
  return resolveEffectiveLabSessionRow(next, idMap, depth + 1);
}

async function expandSupersedeClosure(rows, selectWide, selectNarrow) {
  const idMap = new Map();
  for (const r of rows) {
    if (r && r.id != null) idMap.set(Number(r.id), r);
  }
  const hasValCols = rows.length && Object.prototype.hasOwnProperty.call(rows[0], 'validation_status');
  if (!hasValCols) return { idMap, hasValidationColumns: false };

  let pending = new Set();
  for (const r of rows) {
    if (normalizeText(r?.validation_status).toLowerCase() === 'superseded' && r.superseded_by_session_id != null) {
      const sid = Number(r.superseded_by_session_id);
      if (!idMap.has(sid)) pending.add(sid);
    }
  }
  while (pending.size) {
    const ids = [...pending];
    pending = new Set();
    let rq = await supabase.from('lab_sessions').select(selectWide).in('id', ids);
    if (rq?.error && (isMissingColumnError(rq.error, 'gemini_raw') || isMissingColumnError(rq.error, 'structured_json'))) {
      rq = await supabase.from('lab_sessions').select(selectNarrow).in('id', ids);
    }
    const chunk = Array.isArray(rq?.data) ? rq.data : [];
    for (const row of chunk) {
      idMap.set(Number(row.id), row);
      if (normalizeText(row?.validation_status).toLowerCase() === 'superseded' && row.superseded_by_session_id != null) {
        const sid = Number(row.superseded_by_session_id);
        if (!idMap.has(sid)) pending.add(sid);
      }
    }
  }
  return { idMap, hasValidationColumns: true };
}

function pickBestEffectiveLabSessionRow(initialRowsOrderedNewestFirst, idMap) {
  const skippedSuperseded = [];
  const replacedFromIds = [];
  const candidates = [];
  const seenEff = new Set();

  for (const orig of initialRowsOrderedNewestFirst) {
    if (!orig) continue;
    if (normalizeText(orig.validation_status).toLowerCase() === 'superseded') {
      skippedSuperseded.push(Number(orig.id));
    }
    const eff = resolveEffectiveLabSessionRow(orig, idMap, 0);
    if (!eff) continue;
    if (normalizeText(eff.validation_status).toLowerCase() === 'superseded') continue;
    if (Number(eff.id) !== Number(orig.id)) {
      replacedFromIds.push({ from: Number(orig.id), to: Number(eff.id) });
    }
    if (seenEff.has(Number(eff.id))) continue;
    seenEff.add(Number(eff.id));
    candidates.push(eff);
  }

  const uniqSkipped = [...new Set(skippedSuperseded.filter((x) => Number.isFinite(x)))];
  candidates.sort((a, b) => {
    const ta = validationPriorityTier(a.validation_status);
    const tb = validationPriorityTier(b.validation_status);
    if (ta !== tb) return ta - tb;
    const ca = String(a.created_at || '');
    const cb = String(b.created_at || '');
    if (ca !== cb) return cb.localeCompare(ca);
    return Number(b.id) - Number(a.id);
  });

  let selectionReason = 'usable_content_or_meta';
  if (candidates.length >= 2) {
    const t0 = validationPriorityTier(candidates[0].validation_status);
    const t1 = validationPriorityTier(candidates[1].validation_status);
    if (t0 !== t1) selectionReason = 'validation_tier_preference';
  }
  if (replacedFromIds.length) {
    selectionReason = `supersede_chain:${replacedFromIds.slice(0, 5).map((x) => `${x.from}->${x.to}`).join(',')}`;
  }

  for (const eff of candidates) {
    if (sessionRowHasUsableFollowupContent(eff)) {
      return {
        row: eff,
        trace: {
          skipped_superseded_session_ids: uniqSkipped,
          replaced_from_ids: replacedFromIds,
          selection_reason: selectionReason,
          selected_session_id: Number(eff.id),
          selected_validation_status: eff.validation_status != null ? String(eff.validation_status) : null,
          selected_superseded_by_session_id: eff.superseded_by_session_id != null ? Number(eff.superseded_by_session_id) : null
        }
      };
    }
  }
  return {
    row: null,
    trace: {
      skipped_superseded_session_ids: uniqSkipped,
      replaced_from_ids: replacedFromIds,
      selection_reason: candidates.length ? 'no_usable_followup_content' : 'no_candidates',
      selected_session_id: null,
      selected_validation_status: null,
      selected_superseded_by_session_id: null
    }
  };
}

async function fetchUserLabSessionsNewest(userId, limit, sel, selNarrow) {
  let q = await supabase
    .from('lab_sessions')
    .select(sel)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (q?.error && (isMissingColumnError(q.error, 'gemini_raw') || isMissingColumnError(q.error, 'structured_json'))) {
    q = await supabase
      .from('lab_sessions')
      .select(selNarrow)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
  }
  if (q?.error && isMissingColumnError(q.error, 'validation_status')) {
    const selNoVal = sel.replace(/,validation_status,superseded_by_session_id/g, '');
    const narrowNoVal = selNarrow.replace(/,validation_status,superseded_by_session_id/g, '');
    q = await supabase
      .from('lab_sessions')
      .select(selNoVal)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (q?.error && (isMissingColumnError(q.error, 'gemini_raw') || isMissingColumnError(q.error, 'structured_json'))) {
      q = await supabase
        .from('lab_sessions')
        .select(narrowNoVal)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
    }
  }
  return q;
}

async function getLatestLabSessionWithSelection(userId) {
  const emptyTrace = {
    skipped_superseded_session_ids: [],
    replaced_from_ids: [],
    selection_reason: 'missing_supabase_or_user',
    selected_session_id: null,
    selected_validation_status: null,
    selected_superseded_by_session_id: null
  };
  if (!supabase) return { session: null, selectionTrace: emptyTrace };
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return { session: null, selectionTrace: { ...emptyTrace, selection_reason: 'missing_user' } };
  const sel =
    'id,user_id,status,patient_name,facility_name,print_date,exam_dates_json,parsed_items_json,raw_text,gemini_raw,structured_json,created_at,validation_status,superseded_by_session_id';
  const selNarrow =
    'id,user_id,status,patient_name,facility_name,print_date,exam_dates_json,parsed_items_json,raw_text,created_at,validation_status,superseded_by_session_id';
  try {
    const q = await fetchUserLabSessionsNewest(safeUserId, 20, sel, selNarrow);
    if (q?.error || !Array.isArray(q.data)) {
      return { session: null, selectionTrace: { ...emptyTrace, selection_reason: normalizeText(q?.error?.message || 'fetch_failed') } };
    }
    const { idMap } = await expandSupersedeClosure(q.data, sel, selNarrow);
    const picked = pickBestEffectiveLabSessionRow(q.data, idMap);
    return { session: picked.row, selectionTrace: picked.trace };
  } catch (_e) {
    return { session: null, selectionTrace: { ...emptyTrace, selection_reason: 'exception' } };
  }
}

async function getLatestLabSession(userId) {
  const pack = await getLatestLabSessionWithSelection(userId);
  return pack.session;
}

/** active context の session が superseded か判定するための軽量取得 */
async function getLabSessionValidationBrief(sessionId) {
  if (!supabase || sessionId == null) return null;
  const sid = Number(sessionId);
  if (!Number.isFinite(sid)) return null;
  try {
    let q = await supabase
      .from('lab_sessions')
      .select('id,validation_status,superseded_by_session_id')
      .eq('id', sid)
      .maybeSingle();
    if (q?.error && isMissingColumnError(q.error, 'validation_status')) {
      q = await supabase.from('lab_sessions').select('id').eq('id', sid).maybeSingle();
    }
    if (q?.error || !q?.data) return null;
    return q.data;
  } catch (_e) {
    return null;
  }
}

/**
 * 直近 N 件の lab_sessions。Supabase では日付式 ORDER が重いため、
 * 十分な行を created_at desc で取り、代表日で再ソートして N 件に切る。
 * @param {string} userId
 * @param {number} [limit=10]
 * @param {object} [opts] fetchMultiplier 取得バッファ（既定 8）
 * @returns {Promise<object[]|null>} 代表日新しい順（同一日付なら id 大きい＝新しい行）
 */
async function getRecentLabSessions(userId, limit = 10, opts = {}) {
  if (!supabase) return null;
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return null;
  const mult = Number(opts.fetchMultiplier) > 0 ? Number(opts.fetchMultiplier) : 8;
  const fetchN = Math.min(200, Math.max(Number(limit) || 10, 1) * mult);
  const sel =
    'id,user_id,status,patient_name,facility_name,print_date,exam_dates_json,parsed_items_json,raw_text,created_at,updated_at,validation_status,superseded_by_session_id';
  try {
    let q = await supabase
      .from('lab_sessions')
      .select(`${sel},gemini_raw,structured_json`)
      .eq('user_id', safeUserId)
      .order('created_at', { ascending: false })
      .limit(fetchN);
    if (q?.error && (isMissingColumnError(q.error, 'gemini_raw') || isMissingColumnError(q.error, 'structured_json'))) {
      q = await supabase
        .from('lab_sessions')
        .select(sel)
        .eq('user_id', safeUserId)
        .order('created_at', { ascending: false })
        .limit(fetchN);
    }
    if (q?.error && isMissingColumnError(q.error, 'validation_status')) {
      const selLegacy = sel.replace(/,validation_status,superseded_by_session_id/g, '');
      q = await supabase
        .from('lab_sessions')
        .select(`${selLegacy},gemini_raw,structured_json`)
        .eq('user_id', safeUserId)
        .order('created_at', { ascending: false })
        .limit(fetchN);
      if (q?.error && (isMissingColumnError(q.error, 'gemini_raw') || isMissingColumnError(q.error, 'structured_json'))) {
        q = await supabase
          .from('lab_sessions')
          .select(selLegacy)
          .eq('user_id', safeUserId)
          .order('created_at', { ascending: false })
          .limit(fetchN);
      }
    }
    if (q?.error) return null;
    const raw = Array.isArray(q.data) ? q.data : [];
    const selForExpand = sel.includes('validation_status')
      ? sel
      : sel.replace(/,validation_status,superseded_by_session_id/g, '');
    const { idMap } = await expandSupersedeClosure(
      raw,
      `${selForExpand},gemini_raw,structured_json`,
      selForExpand
    );
    const orderedEffective = [];
    const seenEff = new Set();
    for (const orig of raw) {
      const eff = resolveEffectiveLabSessionRow(orig, idMap, 0);
      if (!eff) continue;
      if (normalizeText(eff.validation_status).toLowerCase() === 'superseded') continue;
      if (seenEff.has(Number(eff.id))) continue;
      seenEff.add(Number(eff.id));
      orderedEffective.push(eff);
    }
    const withRep = orderedEffective.map((r) => ({ ...r, _rep: repDateForRow(r) }));
    withRep.sort((a, b) => {
      const ra = a._rep;
      const rb = b._rep;
      if (ra && rb) {
        const d = String(rb).localeCompare(String(ra));
        if (d !== 0) return d;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      }
      if (ra && !rb) return -1;
      if (!ra && rb) return 1;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    return withRep.slice(0, limit);
  } catch (_e) {
    return null;
  }
}

async function updateLatestLabSessionMeta(userId, patch = {}) {
  if (!supabase) return { ok: false, reason: 'missing_supabase' };
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return { ok: false, reason: 'missing_user' };
  const patchClean = sanitizeMetaCorrectionPatch(patch);
  const next = {};
  if (Object.prototype.hasOwnProperty.call(patchClean, 'patientName')) next.patient_name = normalizeText(patchClean.patientName || '');
  if (Object.prototype.hasOwnProperty.call(patchClean, 'facilityName')) next.facility_name = normalizeText(patchClean.facilityName || '');
  if (Object.prototype.hasOwnProperty.call(patchClean, 'printDate')) next.print_date = normalizeText(patchClean.printDate || '') || null;
  if (!Object.keys(next).length) return { ok: false, reason: 'empty_patch' };
  next.updated_at = new Date().toISOString();
  try {
    const latest = await getLatestLabSession(safeUserId);
    if (!latest?.id) {
      return { ok: false, reason: 'latest_not_found' };
    }
    const upd = await supabase
      .from('lab_sessions')
      .update(next)
      .eq('id', latest.id)
      .select('id,user_id,patient_name,facility_name,print_date,updated_at')
      .limit(1)
      .maybeSingle();
    if (upd?.error || !upd?.data) {
      return { ok: false, reason: normalizeText(upd?.error?.message || 'update_failed') };
    }
    return { ok: true, row: upd.data };
  } catch (e) {
    return { ok: false, reason: normalizeText(e?.message || 'update_failed') };
  }
}

async function appendLatestLabSessionCorrectionAudit(userId, entry = {}) {
  if (!supabase) return { ok: false, reason: 'missing_supabase' };
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return { ok: false, reason: 'missing_user' };
  const correctionType = normalizeText(entry?.correctionType || '');
  if (!correctionType) return { ok: false, reason: 'missing_correction_type' };
  try {
    const latest = await getLatestLabSession(safeUserId);
    if (!latest?.id) {
      return { ok: false, reason: 'latest_not_found' };
    }
    const gr = await supabase
      .from('lab_sessions')
      .select('id,gemini_raw')
      .eq('id', latest.id)
      .maybeSingle();
    if (gr?.error || !gr?.data?.id) {
      return { ok: false, reason: normalizeText(gr?.error?.message || 'read_failed') };
    }
    const currentGeminiRaw = gr.data.gemini_raw && typeof gr.data.gemini_raw === 'object'
      ? { ...gr.data.gemini_raw }
      : {};
    const currentAudit = Array.isArray(currentGeminiRaw.correction_audit)
      ? [...currentGeminiRaw.correction_audit]
      : [];
    let patchForAudit = entry?.patch && typeof entry.patch === 'object' ? { ...entry.patch } : {};
    if (normalizeText(correctionType) === 'meta') {
      patchForAudit = sanitizeMetaCorrectionPatch(patchForAudit);
    }
    currentAudit.push({
      correction_type: correctionType,
      patch: patchForAudit,
      at: new Date().toISOString()
    });
    const upd = await supabase
      .from('lab_sessions')
      .update({
        gemini_raw: {
          ...currentGeminiRaw,
          correction_audit: currentAudit
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', latest.id)
      .select('id,updated_at,gemini_raw')
      .limit(1)
      .maybeSingle();
    if (upd?.error || !upd?.data?.id) {
      return { ok: false, reason: normalizeText(upd?.error?.message || 'update_failed') };
    }
    return { ok: true, row: upd.data };
  } catch (e) {
    return { ok: false, reason: normalizeText(e?.message || 'update_failed') };
  }
}

function repDateForRow(row) {
  const p = String(row.print_date || '').trim();
  if (p) {
    const m = p.match(/(20\d{2}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const ex = Array.isArray(row.exam_dates_json) ? row.exam_dates_json : [];
  const dts = ex
    .map((d) => {
      const s = String(d || '');
      const m2 = s.match(/(20\d{2}-\d{2}-\d{2})/);
      return m2 ? m2[1] : '';
    })
    .filter(Boolean)
    .sort();
  if (dts.length) return dts[dts.length - 1];
  return '';
}

module.exports = {
  createLabSession,
  getLatestLabSession,
  getLatestLabSessionWithSelection,
  getLabSessionValidationBrief,
  getRecentLabSessions,
  repDateForRow,
  updateLatestLabSessionMeta,
  appendLatestLabSessionCorrectionAudit
};
