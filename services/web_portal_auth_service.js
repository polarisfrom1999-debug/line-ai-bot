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

async function cleanupExpiredArtifacts(force = false) {
  const nowTs = Date.now();
  if (!force && lastCleanupAt && nowTs - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  if (!force && cleanupPromise) return cleanupPromise;

  const currentIso = now().toISOString();
  cleanupPromise = Promise.allSettled([
    supabase.from('web_link_codes').delete().lt('expires_at', currentIso),
    supabase.from('web_portal_sessions').update({ revoked_at: currentIso }).lt('expires_at', currentIso).is('revoked_at', null)
  ]).finally(() => {
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

async function findAvailableCode() {
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

async function createLinkCodeForLineUser(lineUserId) {
  await cleanupExpiredArtifacts();
  const user = await getUserByLineUserId(lineUserId);
  if (!user?.id) throw new Error('LINE user not found');

  const expiresAt = addMinutes(now(), LINK_CODE_MINUTES).toISOString();
  const code = await findAvailableCode();

  await supabase
    .from('web_link_codes')
    .delete()
    .eq('user_id', user.id)
    .is('used_at', null);

  const payload = {
    user_id: user.id,
    line_user_id: user.line_user_id,
    code,
    expires_at: expiresAt
  };

  const { error } = await supabase.from('web_link_codes').insert(payload);
  if (error) throw error;

  return {
    user,
    code,
    expiresAt
  };
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

async function consumeLinkCode(code, meta = {}) {
  await cleanupExpiredArtifacts();
  const safeCode = normalizeCode(code);
  if (!safeCode) throw new Error('接続コードが空です');

  const ipAddress = normalizeIpAddress(meta.ipAddress || '');
  if (ipAddress) touchConfirmAttempt(`ip:${ipAddress}`);
  touchConfirmAttempt(`code:${safeCode}`);

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

  if (ipAddress) clearConfirmAttempts(`ip:${ipAddress}`);
  clearConfirmAttempts(`code:${safeCode}`);

  return {
    sessionToken,
    expiresAt,
    user
  };
}

async function getSessionByToken(sessionToken) {
  await cleanupExpiredArtifacts();
  const safeToken = normalizeText(sessionToken);
  if (!safeToken) return null;

  const tokenHash = sha256(safeToken);
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
    lineUserId: session.line_user_id || user?.line_user_id || null
  };
}

async function revokeSession(sessionToken) {
  const safeToken = normalizeText(sessionToken);
  if (!safeToken) return { ok: true };
  const tokenHash = sha256(safeToken);
  const { error } = await supabase
    .from('web_portal_sessions')
    .update({ revoked_at: now().toISOString() })
    .eq('token_hash', tokenHash)
    .is('revoked_at', null);
  if (error) throw error;
  return { ok: true };
}

module.exports = {
  LINK_CODE_MINUTES,
  SESSION_DAYS,
  requestLinkCode,
  createLinkCodeForLineUser,
  consumeLinkCode,
  getSessionByToken,
  revokeSession,
  cleanupExpiredArtifacts
};
