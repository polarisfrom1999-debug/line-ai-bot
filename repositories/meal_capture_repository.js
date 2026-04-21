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

async function createMealCaptureSession(params = {}) {
  if (!supabase) return { ok: false, reason: 'missing_supabase' };
  const userId = normalizeText(params.userId);
  if (!userId) return { ok: false, reason: 'missing_user' };
  const now = new Date().toISOString();
  try {
    const { data, error } = await supabase
      .from('meal_capture_sessions')
      .insert({
        user_id: userId,
        source_channel: normalizeText(params.sourceChannel || 'line'),
        source_message_id: normalizeText(params.sourceMessageId || ''),
        source_image_id: normalizeText(params.sourceImageId || ''),
        status: normalizeText(params.status || 'active') || 'active',
        active_meal_log_id: params.activeMealLogId || null,
        created_at: now,
        updated_at: now,
        expires_at: params.expiresAt || null,
      })
      .select('id,user_id,status,created_at')
      .limit(1)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: normalizeText(error?.message || 'insert_failed') };
    return { ok: true, session: data };
  } catch (error) {
    return { ok: false, reason: normalizeText(error?.message || 'insert_failed') };
  }
}

async function appendMealCaptureEvent(params = {}) {
  if (!supabase) return { ok: false, reason: 'missing_supabase' };
  const sessionId = Number(params.sessionId || 0);
  const userId = normalizeText(params.userId);
  const eventKind = normalizeText(params.eventKind);
  if (!sessionId || !userId || !eventKind) return { ok: false, reason: 'missing_params' };
  try {
    const { error } = await supabase
      .from('meal_capture_events')
      .insert({
        session_id: sessionId,
        user_id: userId,
        event_kind: eventKind,
        payload_jsonb: params.payload && typeof params.payload === 'object' ? params.payload : {},
      });
    if (error) return { ok: false, reason: normalizeText(error?.message || 'insert_failed') };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: normalizeText(error?.message || 'insert_failed') };
  }
}

module.exports = {
  createMealCaptureSession,
  appendMealCaptureEvent,
};
