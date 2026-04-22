'use strict';

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

async function createLabSession(params = {}) {
  if (!supabase) return { ok: false, reason: 'missing_supabase' };
  const userId = normalizeText(params.userId);
  if (!userId) return { ok: false, reason: 'missing_user' };
  const now = new Date().toISOString();
  const row = {
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
    gemini_raw: params.geminiRaw != null ? params.geminiRaw : null,
    structured_json: params.structuredJson != null ? params.structuredJson : null,
    created_at: now,
    updated_at: now,
    expires_at: params.expiresAt || null,
  };
  try {
    const { data, error } = await supabase
      .from('lab_sessions')
      .insert(row)
      .select('id,user_id,status,created_at')
      .limit(1)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: normalizeText(error?.message || 'insert_failed') };
    return { ok: true, session: data };
  } catch (error) {
    return { ok: false, reason: normalizeText(error?.message || 'insert_failed') };
  }
}

async function getLatestLabSession(userId) {
  if (!supabase) return null;
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return null;
  try {
    const { data, error } = await supabase
      .from('lab_sessions')
      .select('id,user_id,status,patient_name,facility_name,print_date,exam_dates_json,parsed_items_json,raw_text,gemini_raw,structured_json,created_at')
      .eq('user_id', safeUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch (_error) {
    return null;
  }
}

module.exports = {
  createLabSession,
  getLatestLabSession,
};
