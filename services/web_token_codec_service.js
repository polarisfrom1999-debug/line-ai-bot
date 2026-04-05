'use strict';

const crypto = require('crypto');

const VERSION = 2;
const TYPE_LINK = 1;
const TYPE_SESSION = 2;
const TOKEN_SECRET = String(
  process.env.WEB_PORTAL_SIGNING_SECRET ||
  process.env.WEB_SIGNING_SECRET ||
  process.env.LINE_CHANNEL_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'kokokara-web-secret'
);
const SIGNATURE_BYTES = 12;
const LINK_PREFIX = 'K12-';
const SESSION_PREFIX = 'S12-';

function normalizeText(value) {
  return String(value || '').trim();
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64url(value) {
  const safe = normalizeText(value).replace(/-/g, '+').replace(/_/g, '/');
  const padding = safe.length % 4 === 0 ? '' : '='.repeat(4 - (safe.length % 4));
  return Buffer.from(`${safe}${padding}`, 'base64');
}

function uuidToBuffer(uuid) {
  const hex = normalizeText(uuid).replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error('invalid_uuid');
  return Buffer.from(hex, 'hex');
}

function bufferToUuid(buffer) {
  const hex = Buffer.from(buffer).toString('hex');
  if (hex.length !== 32) throw new Error('invalid_uuid_buffer');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function signPayload(payload) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest().subarray(0, SIGNATURE_BYTES);
}

function makeToken(type, { userId, expiresAt } = {}) {
  const safeUserId = normalizeText(userId);
  if (!safeUserId) throw new Error('user_id_required');
  const expSeconds = Math.floor(new Date(expiresAt).getTime() / 1000);
  if (!Number.isFinite(expSeconds) || expSeconds <= 0) throw new Error('expires_at_required');

  const body = Buffer.alloc(22);
  body.writeUInt8(VERSION, 0);
  body.writeUInt8(type, 1);
  body.writeUInt32BE(expSeconds, 2);
  uuidToBuffer(safeUserId).copy(body, 6);
  const signature = signPayload(body);
  return base64url(Buffer.concat([body, signature]));
}

function verifyToken(token, expectedType) {
  const raw = fromBase64url(token);
  if (raw.length !== 22 + SIGNATURE_BYTES) throw new Error('invalid_token');
  const body = raw.subarray(0, 22);
  const signature = raw.subarray(22);
  const expectedSignature = signPayload(body);
  if (!crypto.timingSafeEqual(signature, expectedSignature)) throw new Error('invalid_signature');

  const version = body.readUInt8(0);
  const type = body.readUInt8(1);
  const expSeconds = body.readUInt32BE(2);
  const userId = bufferToUuid(body.subarray(6, 22));
  if (version !== VERSION) throw new Error('unsupported_token_version');
  if (expectedType && type !== expectedType) throw new Error('invalid_token_type');
  if (Date.now() > expSeconds * 1000) throw new Error('token_expired');

  return {
    version,
    type,
    userId,
    expiresAt: new Date(expSeconds * 1000).toISOString()
  };
}

function stripKnownPrefix(token) {
  const safe = normalizeText(token);
  if (safe.startsWith(LINK_PREFIX)) return safe.slice(LINK_PREFIX.length);
  if (safe.startsWith(SESSION_PREFIX)) return safe.slice(SESSION_PREFIX.length);
  return safe;
}

function createLinkCode({ userId, expiresAt }) {
  return `${LINK_PREFIX}${makeToken(TYPE_LINK, { userId, expiresAt })}`;
}

function createSessionToken({ userId, expiresAt }) {
  return `${SESSION_PREFIX}${makeToken(TYPE_SESSION, { userId, expiresAt })}`;
}

function verifyLinkCode(token) {
  return verifyToken(stripKnownPrefix(token), TYPE_LINK);
}

function verifySessionToken(token) {
  return verifyToken(stripKnownPrefix(token), TYPE_SESSION);
}

function looksLikeSignedToken(token) {
  try {
    const raw = fromBase64url(stripKnownPrefix(token));
    return raw.length === 22 + SIGNATURE_BYTES && [1, VERSION].includes(raw.readUInt8(0));
  } catch (_error) {
    return false;
  }
}

module.exports = {
  LINK_PREFIX,
  SESSION_PREFIX,
  createLinkCode,
  createSessionToken,
  verifyLinkCode,
  verifySessionToken,
  looksLikeSignedToken
};
