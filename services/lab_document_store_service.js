'use strict';

const crypto = require('crypto');

const panelByHash = new Map();
const latestHashByUser = new Map();

function normalizeText(value) {
  return String(value || '').trim();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hashBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return '';
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hashImagePayload(payload = {}) {
  if (payload.hash) return normalizeText(payload.hash);
  const hash = hashBuffer(payload.buffer);
  if (hash) return hash;
  const messageId = normalizeText(payload.messageId || '');
  if (messageId) return `message:${messageId}`;
  return '';
}

function getCachedPanelByPayload(userId, payload = {}) {
  const hash = hashImagePayload(payload);
  if (!hash) return null;
  const panel = panelByHash.get(hash);
  if (panel && userId) latestHashByUser.set(String(userId), hash);
  return clone(panel || null);
}

function storePanelForPayload(userId, payload = {}, panel = null) {
  const hash = hashImagePayload(payload);
  if (!hash || !panel) return null;
  const stored = clone({ ...panel, documentHash: hash });
  panelByHash.set(hash, stored);
  if (userId) latestHashByUser.set(String(userId), hash);
  return clone(stored);
}

function getLatestPanelForUser(userId) {
  const hash = latestHashByUser.get(String(userId || ''));
  if (!hash) return null;
  return clone(panelByHash.get(hash) || null);
}

module.exports = {
  hashImagePayload,
  getCachedPanelByPayload,
  storePanelForPayload,
  getLatestPanelForUser
};
