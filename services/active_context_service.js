'use strict';

const contextMemoryService = require('./context_memory_service');
const sessionStateRepository = require('../repositories/session_state_repository');

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeText(value) {
  return String(value || '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

async function setActiveContext(userId, context = {}, baseShortMemory = null) {
  const type = normalizeText(context?.type || '');
  if (!userId || !type) return null;
  const ttlMs = Number(context?.ttlMs || DEFAULT_TTL_MS);
  const createdAt = nowIso();
  const safeTtlMs = Math.max(5 * 60 * 1000, Math.min(MAX_TTL_MS, ttlMs));
  const expiresAt = new Date(Date.now() + safeTtlMs).toISOString();
  const payload = context?.payload && typeof context.payload === 'object' ? context.payload : {};
  const activeContext = {
    type,
    payload,
    createdAt,
    expiresAt
  };
  if (baseShortMemory && typeof baseShortMemory === 'object') {
    await contextMemoryService.saveShortMemory(userId, {
      ...baseShortMemory,
      activeContext
    });
  } else {
    await contextMemoryService.saveShortMemory(userId, { activeContext });
  }
  await sessionStateRepository.closeActiveSessions(userId, 'overwritten_by_new_image').catch(() => null);
  await sessionStateRepository.upsertActiveSession({
    userId,
    sessionType: type,
    payload,
    expiresAt
  }).catch(() => null);
  console.info('[v2-context] active_context_updated', { userId, type, expires_at: expiresAt });
  return activeContext;
}

async function clearActiveContext(userId, baseShortMemory = null) {
  if (!userId) return;
  if (baseShortMemory && typeof baseShortMemory === 'object') {
    const next = { ...baseShortMemory };
    delete next.activeContext;
    await contextMemoryService.saveShortMemory(userId, next);
    await sessionStateRepository.closeActiveSessions(userId, 'cleared_from_short_memory').catch(() => null);
    return;
  }
  await contextMemoryService.saveShortMemory(userId, { activeContext: null });
  await sessionStateRepository.closeActiveSessions(userId, 'cleared').catch(() => null);
}

async function getActiveContext(userId, baseShortMemory = null) {
  if (!userId) return null;
  const shortMemory = baseShortMemory && typeof baseShortMemory === 'object'
    ? baseShortMemory
    : await contextMemoryService.getShortMemory(userId);
  const active = shortMemory?.activeContext;
  if (!active || !active.type) {
    const persisted = await sessionStateRepository.getLatestActiveSession(userId).catch(() => null);
    if (persisted?.type) {
      await contextMemoryService.saveShortMemory(userId, { activeContext: persisted }).catch(() => null);
      console.info('[v2-context] active_context_loaded', { userId, type: persisted.type, expires_at: persisted.expiresAt || '' });
      return persisted;
    }
    return null;
  }
  const exp = Date.parse(active.expiresAt || '');
  if (Number.isFinite(exp) && exp < Date.now()) {
    await clearActiveContext(userId, shortMemory);
    if (active?.id) {
      await sessionStateRepository.markSessionClosedById(active.id, 'expired').catch(() => null);
    }
    console.info('[v2-context] active_context_expired', { userId, type: active.type, expires_at: active.expiresAt || '' });
    return null;
  }
  console.info('[v2-context] active_context', { userId, type: active.type, expires_at: active.expiresAt || '' });
  return active;
}

async function getActiveContextStatus(userId, baseShortMemory = null) {
  if (!userId) return { context: null, expired: false };
  const shortMemory = baseShortMemory && typeof baseShortMemory === 'object'
    ? baseShortMemory
    : await contextMemoryService.getShortMemory(userId);
  const active = shortMemory?.activeContext;
  if (active?.type) {
    const exp = Date.parse(active.expiresAt || '');
    if (Number.isFinite(exp) && exp < Date.now()) {
      await clearActiveContext(userId, shortMemory).catch(() => null);
      if (active?.id) {
        await sessionStateRepository.markSessionClosedById(active.id, 'expired').catch(() => null);
      }
      console.info('[v2-context] active_context_expired', { userId, type: active.type, expires_at: active.expiresAt || '' });
      return { context: null, expired: true };
    }
  }
  const context = await getActiveContext(userId, shortMemory);
  return { context, expired: false };
}

async function touchActiveContextTtl(userId, context = null, ttlMs = DEFAULT_TTL_MS) {
  const active = context || await getActiveContext(userId);
  if (!active?.type) return null;
  const safeTtlMs = Math.max(5 * 60 * 1000, Math.min(MAX_TTL_MS, Number(ttlMs || DEFAULT_TTL_MS)));
  return setActiveContext(userId, {
    type: active.type,
    payload: active.payload || {},
    ttlMs: safeTtlMs,
  });
}

module.exports = {
  setActiveContext,
  getActiveContext,
  clearActiveContext,
  touchActiveContextTtl,
  getActiveContextStatus,
  DEFAULT_TTL_MS,
  MAX_TTL_MS
};
