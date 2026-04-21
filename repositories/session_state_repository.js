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
      .select('session_type,payload_jsonb,created_at,expires_at,status')
      .eq('user_id', safeUserId)
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gte.${now}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      type: normalizeText(data.session_type),
      payload: safeJson(data.payload_jsonb),
      createdAt: data.created_at || '',
      expiresAt: data.expires_at || '',
      status: data.status || 'active',
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
      .select('session_type,payload_jsonb,created_at,expires_at,status')
      .eq('user_id', safeUserId)
      .eq('status', 'active')
      .in('session_type', safeTypes)
      .or(`expires_at.is.null,expires_at.gte.${now}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      type: normalizeText(data.session_type),
      payload: safeJson(data.payload_jsonb),
      createdAt: data.created_at || '',
      expiresAt: data.expires_at || '',
      status: data.status || 'active',
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

module.exports = {
  upsertActiveSession,
  getLatestActiveSession,
  getLatestActiveSessionByTypes,
  closeActiveSessions,
};
