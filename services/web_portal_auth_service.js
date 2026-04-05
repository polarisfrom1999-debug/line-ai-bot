'use strict';

const crypto = require('crypto');
const { supabase } = require('./supabase_service');
const { ensureUser } = require('./user_service');

const LINK_CODE_MINUTES = Number(process.env.WEB_LINK_CODE_MINUTES || 15);
const SESSION_DAYS = Number(process.env.WEB_SESSION_DAYS || 30);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLEANUP_INTERVAL_MS = Number(process.env.WEB_CLEANUP_INTERVAL_MS || 5 * 60 * 1000);
const CONFIRM_ATTEMPT_LIMIT = Number(process.env.WEB_CONFIRM_ATTEMPT_LIMIT || 10);
const CONFIRM_ATTEMPT_WINDOW_MS = Number(process.env.WEB_CONFIRM_ATTEMPT_WINDOW_MS || 10 * 60 * 1000);

let lastCleanupAt = 0;
let cleanupPromise = null;
const confirmAttemptStore = new Map();

// Hobby / single-instance safe fallback. When the web tables are not prepared yet,
// LINE-side code issuance and /web confirmation still work within the same running process.
const memoryStore = {
  mode: 'auto',
  lastFallbackReason: '',
  codesByCode: new Map(),
  activeCodeByUserId: new Map(),
  sessionsByHash: new Map()
};

function now() {
  return new Date();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function randomCode(length = 8) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function randomToken(length = 32) {
  return crypto.randomBytes(length).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeCode(value) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, '');
}

function normalizeIpAddress(value) {
  return normalizeText(String(value || '').split(',')[0] || '').slice(0, 100);
}

function touchConfirmAttempt(key) {
  if (!key) return;
  const nowTs = Date.now();
  const entries = (confirmAttemptStore.get(key) || []).filter((ts) => nowTs - ts < CONFIRM_ATTEMPT_WINDOW_MS);
  entries.push(nowTs);
  confirmAttemptStore.set(key, entries);
  if (entries.length > CONFIRM_ATTEMPT_LIMIT) {
    const waitMinutes = Math.ceil(CONFIRM_ATTEMPT_WINDOW_MS / 60000);
    throw new Error(`接続コードの確認回数が多すぎます。${waitMinutes}分ほど待ってからもう一度お試しください。`);
  }
}

function clearConfirmAttempts(key) {
  if (!key) return;
  confirmAttemptStore.delete(key);
}

function describeError(error) {
  const code = normalizeText(error?.code || error?.status || '');
  const message = normalizeText(error?.message || error?.details || error?.hint || error || '');
  return `${code} ${message}`.trim();
}

function shouldUseMemoryFallback(error) {
  const text = describeError(error).toLowerCase();
  if (!text) return false;
  return [
    'web_link_codes',
    'web_portal_sessions',
    'relation',
    'does not exist',
    'schema cache',
    'pgrst',
    '42p01',
    'table',
    'column',
    'permission denied'
  ].some((part) => text.includes(part));
}

function switchToMemoryMode(error) {
  memoryStore.mode = 'memory';
  memoryStore.lastFallbackReason = describeError(error);
  console.warn('[web_portal_auth] switching to in-memory fallback:', memoryStore.lastFallbackReason || 'unknown reason');
}

function cleanupMemoryArtifacts() {
  const nowTs = Date.now();

  for (const [code, row] of memoryStore.codesByCode.entries()) {
    if (!row || row.used_at || new Date(row.expires_at).getTime() < nowTs) {
      memoryStore.codesByCode.delete(code);
      if (row?.user_id && memoryStore.activeCodeByUserId.get(row.user_id) === code) {
        memoryStore.activeCodeByUserId.delete(row.user_id);
      }
    }
  }

  for (const [hash, row] of memoryStore.sessionsByHash.entries()) {
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() < nowTs) {
      memoryStore.sessionsByHash.delete(hash);
    }
  }
}

async function cleanupExpiredArtifacts(force = false) {
  const nowTs = Date.now();
  cleanupMemoryArtifacts();
  if (!force && lastCleanupAt && nowTs - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  if (!force && cleanupPromise) return cleanupPromise;
  if (memoryStore.mode === 'memory') {
    lastCleanupAt = Date.now();
    return;
  }

  const currentIso = now().toISOString();
  cleanupPromise = Promise.allSettled([
    supabase.from('web_link_codes').delete().lt('expires_at', currentIso),
    supabase.from('web_portal_sessions').update({ revoked_at: currentIso }).lt('expires_at', currentIso).is('revoked_at', null)
  ]).then((results) => {
    const rejected = results.find((item) => item.status === 'rejected');
    if (rejected && shouldUseMemoryFallback(rejected.reason)) {
      switchToMemoryMode(rejected.reason);
    }
    const fulfilledError = results
      .filter((item) => item.status === 'fulfilled')
      .map((item) => item.value?.error)
      .find(Boolean);
    if (fulfilledError && shouldUseMemoryFallback(fulfilledError)) {
      switchToMemoryMode(fulfilledError);
    }
  }).finally(() => {
    lastCleanupAt = Date.now();
    cleanupPromise = null;
  });

  return cleanupPromise;
}

async function getUserByLineUserId(lineUserId) {
  const safeLineUserId = normalizeText(lineUserId);
  if (!safeLineUserId) return null;
  return ensureUser(supabase, safeLineUserId, 'Asia/Tokyo');
}

async function findAvailableCodeDb() {
  for (let i = 0; i < 10; i += 1) {
    const code = randomCode(8);
    const { data, error } = await supabase
      .from('web_link_codes')
      .select('id')
      .eq('code', code)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return code;
  }
  return `${randomCode(4)}-${randomCode(4)}`;
}

function findAvailableCodeMemory() {
  for (let i = 0; i < 20; i += 1) {
    const code = randomCode(8);
    if (!memoryStore.codesByCode.has(code)) return code;
  }
  return `${randomCode(4)}-${randomCode(4)}`;
}

async function createLinkCodeDb(user) {
  const expiresAt = addMinutes(now(), LINK_CODE_MINUTES).toISOString();
  const code = await findAvailableCodeDb();

  const deleteResult = await supabase
    .from('web_link_codes')
    .delete()
    .eq('user_id', user.id)
    .is('used_at', null);
  if (deleteResult.error) throw deleteResult.error;

  const payload = {
    user_id: user.id,
    line_user_id: user.line_user_id,
    code,
    expires_at: expiresAt
  };

  const insertResult = await supabase.from('web_link_codes').insert(payload);
  if (insertResult.error) throw insertResult.error;

  return {
    user,
    code,
    expiresAt,
    storageMode: 'db'
  };
}

function createLinkCodeMemory(user) {
  cleanupMemoryArtifacts();
  const expiresAt = addMinutes(now(), LINK_CODE_MINUTES).toISOString();
  const code = findAvailableCodeMemory();

  const existingCode = memoryStore.activeCodeByUserId.get(user.id);
  if (existingCode) {
    memoryStore.codesByCode.delete(existingCode);
    memoryStore.activeCodeByUserId.delete(user.id);
  }

  const payload = {
    id: `mem-code-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    user_id: user.id,
    line_user_id: user.line_user_id,
    code,
    expires_at: expiresAt,
    used_at: null,
    created_at: now().toISOString(),
    user_snapshot: user
  };

  memoryStore.codesByCode.set(code, payload);
  memoryStore.activeCodeByUserId.set(user.id, code);

  return {
    user,
    code,
    expiresAt,
    storageMode: 'memory'
  };
}

async function createLinkCodeForLineUser(lineUserId) {
  await cleanupExpiredArtifacts();
  const user = await getUserByLineUserId(lineUserId);
  if (!user?.id) throw new Error('LINEユーザーを特定できませんでした。もう一度お試しください。');

  if (memoryStore.mode === 'memory') {
    return createLinkCodeMemory(user);
  }

  try {
    return await createLinkCodeDb(user);
  } catch (error) {
    if (!shouldUseMemoryFallback(error)) throw error;
    switchToMemoryMode(error);
    return createLinkCodeMemory(user);
  }
}

async function requestLinkCode({ lineUserId, userId } = {}) {
  if (lineUserId) return createLinkCodeForLineUser(lineUserId);
  if (userId) {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
    if (error) throw error;
    if (!data?.line_user_id) throw new Error('Linked LINE account not found');
    return createLinkCodeForLineUser(data.line_user_id);
  }
  throw new Error('lineUserId or userId is required');
}

function resolveMemoryCodeRow(safeCode) {
  const candidateCodes = Array.from(new Set([
    safeCode,
    safeCode.length === 8 ? `${safeCode.slice(0, 4)}-${safeCode.slice(4)}` : '',
    safeCode.includes('-') ? safeCode.replace(/-/g, '') : ''
  ].filter(Boolean)));

  for (const code of candidateCodes) {
    const row = memoryStore.codesByCode.get(code);
    if (row) return row;
  }
  return null;
}

async function consumeLinkCodeDb(safeCode, meta = {}) {
  const candidateCodes = Array.from(new Set([
    safeCode,
    safeCode.length === 8 ? `${safeCode.slice(0, 4)}-${safeCode.slice(4)}` : ''
  ].filter(Boolean)));

  const { data: rows, error } = await supabase
    .from('web_link_codes')
    .select('*')
    .in('code', candidateCodes)
    .limit(1);

  if (error) throw error;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error('接続コードが見つかりません');
  if (row.used_at) throw new Error('この接続コードはすでに使用されています');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error('接続コードの有効期限が切れています');

  const sessionToken = randomToken(24);
  const sessionHash = sha256(sessionToken);
  const expiresAt = addDays(now(), SESSION_DAYS).toISOString();
  const ipAddress = normalizeIpAddress(meta.ipAddress || '');

  const insertPayload = {
    user_id: row.user_id,
    line_user_id: row.line_user_id,
    token_hash: sessionHash,
    expires_at: expiresAt,
    user_agent: normalizeText(meta.userAgent || '').slice(0, 500) || null,
    ip_address: ipAddress || null
  };

  const { error: sessionError } = await supabase.from('web_portal_sessions').insert(insertPayload);
  if (sessionError) throw sessionError;

  const { error: usedError } = await supabase
    .from('web_link_codes')
    .update({ used_at: now().toISOString() })
    .eq('id', row.id)
    .is('used_at', null);
  if (usedError) throw usedError;

  const { data: user, error: userError } = await supabase.from('users').select('*').eq('id', row.user_id).single();
  if (userError) throw userError;

  return {
    sessionToken,
    expiresAt,
    user,
    storageMode: 'db'
  };
}

function consumeLinkCodeMemory(row, meta = {}) {
  if (!row) throw new Error('接続コードが見つかりません');
  if (row.used_at) throw new Error('この接続コードはすでに使用されています');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error('接続コードの有効期限が切れています');

  const sessionToken = randomToken(24);
  const sessionHash = sha256(sessionToken);
  const expiresAt = addDays(now(), SESSION_DAYS).toISOString();

  row.used_at = now().toISOString();
  memoryStore.codesByCode.set(row.code, row);
  if (memoryStore.activeCodeByUserId.get(row.user_id) === row.code) {
    memoryStore.activeCodeByUserId.delete(row.user_id);
  }

  const sessionRow = {
    id: `mem-session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    user_id: row.user_id,
    line_user_id: row.line_user_id,
    token_hash: sessionHash,
    expires_at: expiresAt,
    revoked_at: null,
    user_agent: normalizeText(meta.userAgent || '').slice(0, 500) || null,
    ip_address: normalizeIpAddress(meta.ipAddress || '') || null,
    created_at: now().toISOString(),
    user_snapshot: row.user_snapshot || null
  };

  memoryStore.sessionsByHash.set(sessionHash, sessionRow);

  return {
    sessionToken,
    expiresAt,
    user: row.user_snapshot || null,
    storageMode: 'memory'
  };
}

async function consumeLinkCode(code, meta = {}) {
  await cleanupExpiredArtifacts();
  const safeCode = normalizeCode(code);
  if (!safeCode) throw new Error('接続コードが空です');

  const ipAddress = normalizeIpAddress(meta.ipAddress || '');
  if (ipAddress) touchConfirmAttempt(`ip:${ipAddress}`);
  touchConfirmAttempt(`code:${safeCode}`);

  try {
    const memoryRow = resolveMemoryCodeRow(safeCode);
    if (memoryRow) {
      const memoryResult = consumeLinkCodeMemory(memoryRow, meta);
      if (ipAddress) clearConfirmAttempts(`ip:${ipAddress}`);
      clearConfirmAttempts(`code:${safeCode}`);
      return memoryResult;
    }

    if (memoryStore.mode !== 'memory') {
      const dbResult = await consumeLinkCodeDb(safeCode, meta);
      if (ipAddress) clearConfirmAttempts(`ip:${ipAddress}`);
      clearConfirmAttempts(`code:${safeCode}`);
      return dbResult;
    }

    throw new Error('接続コードが見つかりません');
  } catch (error) {
    if (!shouldUseMemoryFallback(error)) throw error;
    switchToMemoryMode(error);
    const memoryRow = resolveMemoryCodeRow(safeCode);
    if (!memoryRow) throw new Error('接続コードが見つかりません');
    const memoryResult = consumeLinkCodeMemory(memoryRow, meta);
    if (ipAddress) clearConfirmAttempts(`ip:${ipAddress}`);
    clearConfirmAttempts(`code:${safeCode}`);
    return memoryResult;
  }
}

async function getSessionByToken(sessionToken) {
  await cleanupExpiredArtifacts();
  const safeToken = normalizeText(sessionToken);
  if (!safeToken) return null;

  const tokenHash = sha256(safeToken);
  const memorySession = memoryStore.sessionsByHash.get(tokenHash);
  if (memorySession && !memorySession.revoked_at && new Date(memorySession.expires_at).getTime() >= Date.now()) {
    return {
      session: memorySession,
      user: memorySession.user_snapshot || null,
      lineUserId: memorySession.line_user_id || memorySession.user_snapshot?.line_user_id || null,
      storageMode: 'memory'
    };
  }

  if (memoryStore.mode === 'memory') return null;

  try {
    const { data: session, error } = await supabase
      .from('web_portal_sessions')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error) throw error;
    if (!session) return null;
    if (session.revoked_at) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) return null;

    const { data: user, error: userError } = await supabase.from('users').select('*').eq('id', session.user_id).single();
    if (userError) throw userError;

    return {
      session,
      user,
      lineUserId: session.line_user_id || user?.line_user_id || null,
      storageMode: 'db'
    };
  } catch (error) {
    if (!shouldUseMemoryFallback(error)) throw error;
    switchToMemoryMode(error);
    const fallbackMemory = memoryStore.sessionsByHash.get(tokenHash);
    if (!fallbackMemory || fallbackMemory.revoked_at || new Date(fallbackMemory.expires_at).getTime() < Date.now()) return null;
    return {
      session: fallbackMemory,
      user: fallbackMemory.user_snapshot || null,
      lineUserId: fallbackMemory.line_user_id || fallbackMemory.user_snapshot?.line_user_id || null,
      storageMode: 'memory'
    };
  }
}

async function revokeSession(sessionToken) {
  const safeToken = normalizeText(sessionToken);
  if (!safeToken) return { ok: true };
  const tokenHash = sha256(safeToken);

  const memorySession = memoryStore.sessionsByHash.get(tokenHash);
  if (memorySession) {
    memorySession.revoked_at = now().toISOString();
    memoryStore.sessionsByHash.set(tokenHash, memorySession);
  }

  if (memoryStore.mode === 'memory') return { ok: true };

  try {
    const { error } = await supabase
      .from('web_portal_sessions')
      .update({ revoked_at: now().toISOString() })
      .eq('token_hash', tokenHash)
      .is('revoked_at', null);
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    if (!shouldUseMemoryFallback(error)) throw error;
    switchToMemoryMode(error);
    return { ok: true };
  }
}

function getStorageDebugInfo() {
  return {
    mode: memoryStore.mode === 'memory' ? 'memory' : 'db',
    fallbackReason: memoryStore.lastFallbackReason || '',
    activeCodes: memoryStore.codesByCode.size,
    activeSessions: memoryStore.sessionsByHash.size
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
