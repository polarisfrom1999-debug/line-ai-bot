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

function toArray(value) {
  return Array.isArray(value) ? value : [];
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
    exam_dates_json: toArray(params.examDates),
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

async function getLatestLabSession(userId) {
  if (!supabase) return null;
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return null;
  try {
    let q = await supabase
      .from('lab_sessions')
      .select('id,user_id,status,patient_name,facility_name,print_date,exam_dates_json,parsed_items_json,raw_text,gemini_raw,structured_json,created_at')
      .eq('user_id', safeUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (q?.error && (isMissingColumnError(q.error, 'gemini_raw') || isMissingColumnError(q.error, 'structured_json'))) {
      q = await supabase
        .from('lab_sessions')
        .select('id,user_id,status,patient_name,facility_name,print_date,exam_dates_json,parsed_items_json,raw_text,created_at')
        .eq('user_id', safeUserId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    }
    if (q?.error || !q?.data) return null;
    return q.data;
  } catch (_error) {
    return null;
  }
}

module.exports = {
  createLabSession,
  getLatestLabSession,
};
