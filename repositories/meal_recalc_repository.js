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

function toJsonObject(value) {
  return value && typeof value === 'object' ? value : {};
}

async function createBaseMeal(params = {}) {
  if (!supabase) return { ok: false, reason: 'missing_supabase' };
  const userId = normalizeText(params.userId);
  if (!userId) return { ok: false, reason: 'missing_user' };
  const eatenAt = normalizeText(params.eatenAt);
  if (!eatenAt) return { ok: false, reason: 'missing_eaten_at' };
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('base_meals')
      .insert({
        user_id: userId,
        eaten_at: eatenAt,
        base_meal_version: normalizeText(params.baseMealVersion || 'v1') || 'v1',
        source_message_id: normalizeText(params.sourceMessageId || ''),
        source_image_id: normalizeText(params.sourceImageId || ''),
        meal_label: normalizeText(params.mealLabel || '食事') || '食事',
        base_payload_json: toJsonObject(params.basePayloadJson),
        created_at: now,
        updated_at: now,
      })
      .select('id,user_id,eaten_at,base_meal_version,meal_label,created_at')
      .limit(1)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: normalizeText(error?.message || 'insert_failed') };
    return { ok: true, meal: data };
  } catch (error) {
    return { ok: false, reason: normalizeText(error?.message || 'insert_failed') };
  }
}

async function appendCorrectionEvent(params = {}) {
  if (!supabase) return { ok: false, reason: 'missing_supabase' };
  const mealId = Number(params.mealId || 0);
  const userId = normalizeText(params.userId);
  const eventType = normalizeText(params.eventType);
  const dedupeKey = normalizeText(params.dedupeKey);
  if (!mealId || !userId || !eventType || !dedupeKey) return { ok: false, reason: 'missing_params' };
  const payloadJson = toJsonObject(params.payloadJson);
  const priority = Number(params.priority);
  const ts = normalizeText(params.timestamp);
  if (!Number.isFinite(priority)) return { ok: false, reason: 'invalid_priority' };
  if (!ts) return { ok: false, reason: 'missing_timestamp' };
  try {
    const { data, error } = await supabase
      .from('correction_events')
      .insert({
        meal_id: mealId,
        user_id: userId,
        event_type: eventType,
        payload_json: payloadJson,
        priority,
        timestamp: ts,
        dedupe_key: dedupeKey,
        source_message_id: normalizeText(params.sourceMessageId || ''),
        created_by_flow: normalizeText(params.createdByFlow || 'newflow') || 'newflow',
      })
      .select('event_id,meal_id,event_type,priority,timestamp,dedupe_key')
      .limit(1)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: normalizeText(error?.message || 'insert_failed') };
    return { ok: true, event: data };
  } catch (error) {
    return { ok: false, reason: normalizeText(error?.message || 'insert_failed') };
  }
}

async function getBaseMealWithEvents(mealId) {
  if (!supabase) return null;
  const id = Number(mealId || 0);
  if (!id) return null;
  try {
    const { data: meal } = await supabase
      .from('base_meals')
      .select('id,user_id,eaten_at,base_meal_version,source_message_id,source_image_id,meal_label,base_payload_json,created_at,updated_at')
      .eq('id', id)
      .maybeSingle();
    if (!meal) return null;
    const { data: events } = await supabase
      .from('correction_events')
      .select('event_id,meal_id,event_type,payload_json,priority,timestamp,dedupe_key,source_message_id,created_by_flow,created_at')
      .eq('meal_id', id)
      .order('priority', { ascending: true })
      .order('timestamp', { ascending: true })
      .order('event_id', { ascending: true });
    return {
      meal,
      events: Array.isArray(events) ? events : [],
    };
  } catch (_error) {
    return null;
  }
}

async function getLatestBaseMealByUser(userId) {
  if (!supabase) return null;
  const uid = normalizeText(userId);
  if (!uid) return null;
  try {
    const { data } = await supabase
      .from('base_meals')
      .select('id,user_id,eaten_at,base_meal_version,source_message_id,source_image_id,meal_label,base_payload_json,created_at,updated_at')
      .eq('user_id', uid)
      .order('eaten_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data || null;
  } catch (_error) {
    return null;
  }
}

async function getBaseMealsByDateRange(userId, fromIso, toIso) {
  if (!supabase) return [];
  const uid = normalizeText(userId);
  if (!uid || !normalizeText(fromIso) || !normalizeText(toIso)) return [];
  try {
    const { data, error } = await supabase
      .from('base_meals')
      .select('id,user_id,eaten_at,base_meal_version,source_message_id,source_image_id,meal_label,base_payload_json,created_at,updated_at')
      .eq('user_id', uid)
      .gte('eaten_at', fromIso)
      .lt('eaten_at', toIso)
      .order('eaten_at', { ascending: false });
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch (_error) {
    return [];
  }
}

module.exports = {
  createBaseMeal,
  appendCorrectionEvent,
  getBaseMealWithEvents,
  getLatestBaseMealByUser,
  getBaseMealsByDateRange,
};
