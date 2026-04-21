'use strict';

const contextMemoryService = require('./context_memory_service');

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

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
  const expiresAt = new Date(Date.now() + Math.max(5 * 60 * 1000, ttlMs)).toISOString();
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
  return activeContext;
}

async function clearActiveContext(userId, baseShortMemory = null) {
  if (!userId) return;
  if (baseShortMemory && typeof baseShortMemory === 'object') {
    const next = { ...baseShortMemory };
    delete next.activeContext;
    await contextMemoryService.saveShortMemory(userId, next);
    return;
  }
  await contextMemoryService.saveShortMemory(userId, { activeContext: null });
}

async function getActiveContext(userId, baseShortMemory = null) {
  if (!userId) return null;
  const shortMemory = baseShortMemory && typeof baseShortMemory === 'object'
    ? baseShortMemory
    : await contextMemoryService.getShortMemory(userId);
  const active = shortMemory?.activeContext;
  if (!active || !active.type) return null;
  const exp = Date.parse(active.expiresAt || '');
  if (Number.isFinite(exp) && exp < Date.now()) {
    await clearActiveContext(userId, shortMemory);
    return null;
  }
  return active;
}

module.exports = {
  setActiveContext,
  getActiveContext,
  clearActiveContext
};
