'use strict';

const crypto = require('crypto');
const { supabase } = require('./supabase_service');
const { ensureUser } = require('./user_service');
const tokenCodec = require('./web_token_codec_service');

const LINK_CODE_MINUTES = Number(process.env.WEB_LINK_CODE_MINUTES || 15);
const SESSION_DAYS = Number(process.env.WEB_SESSION_DAYS || 30);
const revokeStore = new Map();

function now() {
  return new Date();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function cleanupRevokes() {
  const nowTs = Date.now();
  for (const [hash, expiresAt] of revokeStore.entries()) {
    if (!expiresAt || expiresAt <= nowTs) revokeStore.delete(hash);
  }
}

function extractCodeCandidate(value) {
  const safe = normalizeText(value);
  if (!safe) return '';
  if (/^https?:\/\//i.test(safe)) {
    try {
      const url = new URL(safe);
      return normalizeText(url.searchParams.get('code') || url.searchParams.get('token') || '');
    } catch (_error) {
      return safe;
    }
  }
  return safe;
}

async function getUserByLineUserId(lineUserId) {
  const safeLineUserId = normalizeText(lineUserId);
  if (!safeLineUserId) return null;
  return ensureUser(supabase, safeLineUserId, 'Asia/Tokyo');
}

async function getUserById(userId) {
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return null;
  const { data, error } = await supabase.from('users').select('*').eq('id', safeUserId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function createLinkCodeForLineUser(lineUserId) {
  const user = await getUserByLineUserId(lineUserId);
  if (!user?.id) throw new Error('LINEユーザーを特定できませんでした。もう一度お試しください。');

  const expiresAt = addMinutes(now(), LINK_CODE_MINUTES).toISOString();
  const code = tokenCodec.createLinkCode({ userId: user.id, expiresAt });

  return {
    user,
    code,
    expiresAt,
    storageMode: 'stateless'
  };
}

async function requestLinkCode({ lineUserId, userId } = {}) {
  if (lineUserId) return createLinkCodeForLineUser(lineUserId);
  if (userId) {
    const user = await getUserById(userId);
    if (!user?.line_user_id) throw new Error('LINE連携ユーザーが見つかりませんでした。');
    return createLinkCodeForLineUser(user.line_user_id);
  }
  throw new Error('lineUserId or userId is required');
}

async function consumeLinkCode(code, _meta = {}) {
  const safeCode = extractCodeCandidate(code);
  if (!safeCode) throw new Error('接続コードが空です');

  const decoded = tokenCodec.verifyLinkCode(safeCode);
  const user = await getUserById(decoded.userId);
  if (!user?.id) throw new Error('接続先ユーザーを確認できませんでした。もう一度コードを発行してください。');

  const sessionExpiresAt = addDays(now(), SESSION_DAYS).toISOString();
  const sessionToken = tokenCodec.createSessionToken({ userId: user.id, expiresAt: sessionExpiresAt });

  return {
    sessionToken,
    expiresAt: sessionExpiresAt,
    user,
    storageMode: 'stateless'
  };
}

async function getSessionByToken(sessionToken) {
  cleanupRevokes();
  const safeToken = extractCodeCandidate(sessionToken);
  if (!safeToken) return null;

  const tokenHash = sha256(safeToken);
  const revokedUntil = revokeStore.get(tokenHash);
  if (revokedUntil && revokedUntil > Date.now()) return null;

  const decoded = tokenCodec.verifySessionToken(safeToken);
  const user = await getUserById(decoded.userId);
  if (!user?.id) return null;

  return {
    session: {
      token_hash: tokenHash,
      expires_at: decoded.expiresAt,
      revoked_at: null,
      mode: 'stateless'
    },
    user,
    lineUserId: user.line_user_id || null,
    storageMode: 'stateless'
  };
}

async function revokeSession(sessionToken) {
  const safeToken = extractCodeCandidate(sessionToken);
  if (!safeToken) return { ok: true };
  try {
    const decoded = tokenCodec.verifySessionToken(safeToken);
    revokeStore.set(sha256(safeToken), new Date(decoded.expiresAt).getTime());
  } catch (_error) {
    // ignore invalid/expired tokens on logout
  }
  cleanupRevokes();
  return { ok: true };
}

async function cleanupExpiredArtifacts() {
  cleanupRevokes();
}

function getStorageDebugInfo() {
  cleanupRevokes();
  return {
    mode: 'stateless',
    fallbackReason: '',
    activeCodes: 0,
    activeSessions: 0,
    revokedSessions: revokeStore.size
  };
}

module.exports = {
  LINK_CODE_MINUTES,
  SESSION_DAYS,
  requestLinkCode,
  createLinkCodeForLineUser,
  consumeLinkCode,
  getSessionByToken,
  revokeSession,
  cleanupExpiredArtifacts,
  getStorageDebugInfo
};
