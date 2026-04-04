'use strict';

const crypto = require('crypto');

let supabase = null;
let ensureUser = null;
try {
  ({ supabase } = require('./supabase_service'));
  ({ ensureUser } = require('./user_service'));
} catch (_error) {
  supabase = null;
  ensureUser = null;
}

const fallbackLogStore = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function truncate(value, max = 4000) {
  const safe = String(value || '');
  return safe.length <= max ? safe : `${safe.slice(0, max - 1)}…`;
}

function buildTraceId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function joinReplyText(replyMessages) {
  return (Array.isArray(replyMessages) ? replyMessages : [])
    .filter(Boolean)
    .map((message) => normalizeText(message?.text || ''))
    .filter(Boolean)
    .join('\n');
}

function inferImageContextType(input, result) {
  const intent = normalizeText(result?.internal?.intentType || '');
  if (intent.includes('meal')) return 'meal';
  if (intent.includes('lab')) return 'lab';
  if (/pain|symptom|consult|homecare/.test(intent)) return 'consultation';
  if (input?.messageType === 'image') return 'unknown';
  return null;
}

function inferModelUsed(input, result, role = 'assistant') {
  const intent = normalizeText(result?.internal?.intentType || '');
  if (input?.messageType === 'image' && /meal|lab/.test(intent)) return 'gemini';
  if (intent === 'fallback' || result?.internal?.responseMode === 'empathy_only') return 'fallback';
  if (role === 'system') return 'orchestrator';
  return 'openai';
}

function summarizeProcessing(result) {
  const internal = result?.internal || {};
  const parts = [];
  if (internal.intentType) parts.push(`intent=${internal.intentType}`);
  if (internal.responseMode) parts.push(`mode=${internal.responseMode}`);
  if (internal.symptomArea) parts.push(`symptom=${internal.symptomArea}`);
  if (internal.homecareArea) parts.push(`homecare=${internal.homecareArea}`);
  return parts.join(', ');
}

async function resolvePersistentUser(lineUserId) {
  if (!supabase || !ensureUser || !lineUserId) return null;
  try {
    return await ensureUser(supabase, lineUserId, 'Asia/Tokyo');
  } catch (error) {
    console.error('[chat_log_service] resolvePersistentUser error:', error?.message || error);
    return null;
  }
}

async function insertLog(payload) {
  const safePayload = {
    created_at: payload.created_at || nowIso(),
    user_id: payload.user_id || null,
    line_user_id: payload.line_user_id || null,
    role: payload.role || 'system',
    message_text: truncate(payload.message_text || ''),
    message_type: truncate(payload.message_type || '', 32),
    image_context_type: truncate(payload.image_context_type || '', 32),
    source_channel: payload.source_channel || 'line',
    model_used: truncate(payload.model_used || '', 32),
    trace_id: truncate(payload.trace_id || '', 128),
    related_event_id: truncate(payload.related_event_id || '', 128),
    intent_guess: truncate(payload.intent_guess || '', 120),
    processing_result: truncate(payload.processing_result || '', 1000),
    reply_text: truncate(payload.reply_text || '', 4000),
    error_flag: Boolean(payload.error_flag),
    error_message: truncate(payload.error_message || '', 1000),
    metadata: payload.metadata || {}
  };

  if (!supabase) {
    const key = `${safePayload.line_user_id || safePayload.user_id || 'anonymous'}`;
    const arr = fallbackLogStore.get(key) || [];
    arr.push(safePayload);
    fallbackLogStore.set(key, arr.slice(-500));
    return null;
  }

  try {
    const { error } = await supabase.from('chat_logs').insert(safePayload);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[chat_log_service] insertLog error:', error?.message || error);
    const key = `${safePayload.line_user_id || safePayload.user_id || 'anonymous'}`;
    const arr = fallbackLogStore.get(key) || [];
    arr.push(safePayload);
    fallbackLogStore.set(key, arr.slice(-500));
    return null;
  }
}

async function logConversationOutcome({ input, result }) {
  if (!input || !result) return;

  const persistentUser = await resolvePersistentUser(input.lineUserId || input.userId);
  const replyText = joinReplyText(result.replyMessages);
  const common = {
    user_id: persistentUser?.id || null,
    line_user_id: input.lineUserId || input.userId || null,
    trace_id: input.traceId || buildTraceId(),
    related_event_id: input.relatedEventId || input.messageId || null,
    source_channel: input?.sourceChannel || 'line',
    intent_guess: result?.internal?.intentType || '',
    processing_result: summarizeProcessing(result),
    reply_text: replyText,
    image_context_type: inferImageContextType(input, result)
  };

  const userMessageText = input.messageType === 'text'
    ? normalizeText(input.rawText || '')
    : `[${input.messageType || 'message'}]`;

  await insertLog({
    ...common,
    role: 'user',
    message_text: userMessageText,
    message_type: input.messageType || 'text',
    model_used: inferModelUsed(input, result, 'user'),
    metadata: {
      sourceType: input.sourceType || 'unknown',
      routerHints: input.routerHints || null
    }
  });

  if (replyText) {
    await insertLog({
      ...common,
      role: 'assistant',
      message_text: replyText,
      message_type: 'text',
      model_used: inferModelUsed(input, result, 'assistant'),
      metadata: {
        replyMessageCount: Array.isArray(result.replyMessages) ? result.replyMessages.length : 0
      }
    });
  }

  await insertLog({
    ...common,
    role: 'system',
    message_text: `[system] ${summarizeProcessing(result) || 'completed'}`,
    message_type: 'system',
    model_used: inferModelUsed(input, result, 'system'),
    metadata: {
      internal: result.internal || {},
      ok: Boolean(result.ok)
    }
  });
}

async function logFailedTurn({ input, error, fallbackReplyText }) {
  const persistentUser = await resolvePersistentUser(input?.lineUserId || input?.userId);
  const common = {
    user_id: persistentUser?.id || null,
    line_user_id: input?.lineUserId || input?.userId || null,
    trace_id: input?.traceId || buildTraceId(),
    related_event_id: input?.relatedEventId || input?.messageId || null,
    source_channel: input?.sourceChannel || 'line',
    intent_guess: 'error',
    processing_result: 'fatal_error',
    reply_text: fallbackReplyText || '',
    error_flag: true,
    error_message: error?.message || String(error || 'unknown error'),
    image_context_type: input?.messageType === 'image' ? 'unknown' : null
  };

  await insertLog({
    ...common,
    role: 'user',
    message_text: input?.messageType === 'text' ? normalizeText(input?.rawText || '') : `[${input?.messageType || 'message'}]`,
    message_type: input?.messageType || 'unknown',
    model_used: 'fallback'
  });

  if (fallbackReplyText) {
    await insertLog({
      ...common,
      role: 'assistant',
      message_text: fallbackReplyText,
      message_type: 'text',
      model_used: 'fallback'
    });
  }
}

async function logToolEvent({ input, toolName, payload, resultTag }) {
  const persistentUser = await resolvePersistentUser(input?.lineUserId || input?.userId);
  await insertLog({
    user_id: persistentUser?.id || null,
    line_user_id: input?.lineUserId || input?.userId || null,
    role: 'tool',
    message_text: `[tool] ${toolName || 'unknown'}`,
    message_type: 'tool',
    image_context_type: input?.messageType === 'image' ? 'unknown' : null,
    source_channel: input?.sourceChannel || 'line',
    model_used: /gemini/i.test(String(toolName || '')) ? 'gemini' : 'tool',
    trace_id: input?.traceId || buildTraceId(),
    related_event_id: input?.relatedEventId || input?.messageId || null,
    intent_guess: resultTag || '',
    processing_result: truncate(JSON.stringify(payload || {}), 1000),
    metadata: payload || {}
  });
}

module.exports = {
  buildTraceId,
  logConversationOutcome,
  logFailedTurn,
  logToolEvent,
  joinReplyText
};
