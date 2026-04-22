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

function safeJson(value) {
  return value && typeof value === 'object' ? value : {};
}

async function upsertActiveSession({ userId, sessionType, payload = {}, expiresAt = null }) {
  const safeUserId = normalizeText(userId);
  const safeType = normalizeText(sessionType);
  if (!supabase || !safeUserId || !safeType) return { ok: false, reason: 'missing_supabase_or_params' };
  const now = new Date().toISOString();
  const row = {
    user_id: safeUserId,
    session_type: safeType,
    status: 'active',
    payload_jsonb: safeJson(payload),
    updated_at: now,
    expires_at: expiresAt || null,
    source_image_id: normalizeText(payload?.sourceImageId || payload?.source_image_id || ''),
    raw_gemini_json: payload?.rawGeminiJson && typeof payload.rawGeminiJson === 'object'
      ? payload.rawGeminiJson
      : null,
  };
  try {
    await supabase.from('session_state').insert({
      ...row,
      created_at: now,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: normalizeText(error?.message || 'insert_failed') };
  }
}

async function getLatestActiveSession(userId) {
  const safeUserId = normalizeText(userId);
  if (!supabase || !safeUserId) return null;
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('session_state')
      .select('id,session_type,payload_jsonb,created_at,updated_at,expires_at,status,source_image_id,raw_gemini_json')
      .eq('user_id', safeUserId)
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gte.${now}`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id || null,
      type: normalizeText(data.session_type),
      payload: safeJson(data.payload_jsonb),
      createdAt: data.created_at || '',
      updatedAt: data.updated_at || '',
      expiresAt: data.expires_at || '',
      status: data.status || 'active',
      sourceImageId: normalizeText(data.source_image_id || ''),
      rawGeminiJson: data.raw_gemini_json && typeof data.raw_gemini_json === 'object' ? data.raw_gemini_json : null,
    };
  } catch (_error) {
    return null;
  }
}

async function getLatestActiveSessionByTypes(userId, sessionTypes = []) {
  const safeUserId = normalizeText(userId);
  if (!supabase || !safeUserId) return null;
  const safeTypes = (Array.isArray(sessionTypes) ? sessionTypes : [])
    .map((x) => normalizeText(x))
    .filter(Boolean);
  if (!safeTypes.length) return getLatestActiveSession(userId);
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('session_state')
      .select('id,session_type,payload_jsonb,created_at,updated_at,expires_at,status,source_image_id,raw_gemini_json')
      .eq('user_id', safeUserId)
      .eq('status', 'active')
      .in('session_type', safeTypes)
      .or(`expires_at.is.null,expires_at.gte.${now}`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id || null,
      type: normalizeText(data.session_type),
      payload: safeJson(data.payload_jsonb),
      createdAt: data.created_at || '',
      updatedAt: data.updated_at || '',
      expiresAt: data.expires_at || '',
      status: data.status || 'active',
      sourceImageId: normalizeText(data.source_image_id || ''),
      rawGeminiJson: data.raw_gemini_json && typeof data.raw_gemini_json === 'object' ? data.raw_gemini_json : null,
    };
  } catch (_error) {
    return null;
  }
}

async function closeActiveSessions(userId, reason = 'cleared') {
  const safeUserId = normalizeText(userId);
  if (!supabase || !safeUserId) return { ok: false, reason: 'missing_supabase_or_user' };
  const now = new Date().toISOString();
  try {
    await supabase
      .from('session_state')
      .update({
        status: 'closed',
        updated_at: now,
        closed_at: now,
        payload_jsonb: { close_reason: reason },
      })
      .eq('user_id', safeUserId)
      .eq('status', 'active');
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: normalizeText(error?.message || 'close_failed') };
  }
}

async function markSessionClosedById(sessionId, reason = 'closed') {
  const id = Number(sessionId || 0);
  if (!supabase || !id) return { ok: false, reason: 'missing_supabase_or_id' };
  const now = new Date().toISOString();
  try {
    await supabase
      .from('session_state')
      .update({
        status: 'closed',
        updated_at: now,
        closed_at: now,
        payload_jsonb: { close_reason: reason },
      })
      .eq('id', id);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: normalizeText(error?.message || 'close_failed') };
  }
}

async function verifySessionStateSchema() {
  if (!supabase) return { ok: false, reason: 'missing_supabase' };
  const expected = ['id', 'user_id', 'session_type', 'status', 'payload_jsonb', 'expires_at', 'source_image_id', 'raw_gemini_json', 'updated_at'];
  try {
    const { data, error } = await supabase
      .from('session_state')
      .select(expected.join(','))
      .limit(1);
    if (error) {
      return { ok: false, reason: normalizeText(error?.message || 'schema_select_failed') };
    }
    return { ok: true, columns: expected, sampleCount: Array.isArray(data) ? data.length : 0 };
  } catch (error) {
    return { ok: false, reason: normalizeText(error?.message || 'schema_verify_exception') };
  }
}

module.exports = {
  upsertActiveSession,
  getLatestActiveSession,
  getLatestActiveSessionByTypes,
  closeActiveSessions,
  markSessionClosedById,
  verifySessionStateSchema,
};
