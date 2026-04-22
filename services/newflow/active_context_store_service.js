'use strict';

const sessionStateRepository = require('../../repositories/session_state_repository');

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_CONTEXT_CACHE = new Map();

function normalizeText(value) {
  return String(value || '').trim();
}

function toIsoAfter(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function clampTtlMs(ttlMs) {
  const num = Number(ttlMs || DEFAULT_TTL_MS);
  if (!Number.isFinite(num)) return DEFAULT_TTL_MS;
  return Math.max(5 * 60 * 1000, Math.min(MAX_TTL_MS, num));
}

async function setActiveContext(userId, context = {}) {
  const safeUserId = normalizeText(userId);
  const domain = normalizeText(context?.domain || context?.type || '');
  if (!safeUserId || !domain) return { ok: false, reason: 'missing_user_or_domain' };
  const ttlMs = clampTtlMs(context?.ttlMs);
  const expiresAt = context?.expiresAt || toIsoAfter(ttlMs);
  const payload = context?.payload && typeof context.payload === 'object' ? context.payload : {};
  const memoryPrevious = ACTIVE_CONTEXT_CACHE.get(safeUserId) || null;
  const previous = memoryPrevious || await sessionStateRepository.getLatestActiveSession(safeUserId).catch(() => null);
  const previousType = normalizeText(previous?.type || previous?.domain || '');
  if (previousType && previousType !== domain) {
    console.info('[v2-context] previous_context_closed', {
      userId: safeUserId,
      previous_type: previousType,
      next_type: domain
    });
  }
  await sessionStateRepository.closeActiveSessions(safeUserId, 'newflow_context_replaced').catch(() => null);
  const up = await sessionStateRepository.upsertActiveSession({
    userId: safeUserId,
    sessionType: domain,
    payload,
    expiresAt
  }).catch((error) => ({ ok: false, reason: normalizeText(error?.message || 'upsert_exception') }));
  ACTIVE_CONTEXT_CACHE.set(safeUserId, {
    id: null,
    userId: safeUserId,
    type: domain,
    domain,
    payload,
    expiresAt,
    updatedAt: new Date().toISOString(),
  });
  if (previousType !== domain) {
    console.info('[v2-context] active_context_switched', {
      userId: safeUserId,
      previous_type: previousType || '',
      active_type: domain,
      expires_at: expiresAt
    });
  }
  return { ok: Boolean(up?.ok), expiresAt, reason: up?.reason || '' };
}

async function getActiveContext(userId) {
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return { context: null, expired: false };
  const fromMemory = ACTIVE_CONTEXT_CACHE.get(safeUserId) || null;
  if (fromMemory?.type) {
    const memExpMs = Date.parse(fromMemory.expiresAt || '');
    if (Number.isFinite(memExpMs) && memExpMs < Date.now()) {
      ACTIVE_CONTEXT_CACHE.delete(safeUserId);
      return { context: null, expired: true };
    }
    return {
      context: {
        id: fromMemory.id || null,
        userId: safeUserId,
        type: normalizeText(fromMemory.type),
        domain: normalizeText(fromMemory.domain || fromMemory.type),
        payload: fromMemory.payload && typeof fromMemory.payload === 'object' ? fromMemory.payload : {},
        expiresAt: fromMemory.expiresAt || '',
        updatedAt: fromMemory.updatedAt || '',
      },
      expired: false
    };
  }
  const row = await sessionStateRepository.getLatestActiveSession(safeUserId).catch(() => null);
  if (!row?.type) return { context: null, expired: false };
  const expMs = Date.parse(row.expiresAt || '');
  if (Number.isFinite(expMs) && expMs < Date.now()) {
    if (row?.id) {
      await sessionStateRepository.markSessionClosedById(row.id, 'newflow_expired').catch(() => null);
    } else {
      await sessionStateRepository.closeActiveSessions(safeUserId, 'newflow_expired').catch(() => null);
    }
    return { context: null, expired: true };
  }
  return {
    context: {
      id: row.id || null,
      userId: safeUserId,
      type: normalizeText(row.type),
      domain: normalizeText(row.type),
      payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
      expiresAt: row.expiresAt || '',
      updatedAt: row.updatedAt || '',
    },
    expired: false,
  };
}

async function closeActiveContext(userId, reason = 'closed') {
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return { ok: false, reason: 'missing_user' };
  ACTIVE_CONTEXT_CACHE.delete(safeUserId);
  return sessionStateRepository.closeActiveSessions(safeUserId, normalizeText(reason) || 'closed');
}

module.exports = {
  setActiveContext,
  getActiveContext,
  closeActiveContext,
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
};
