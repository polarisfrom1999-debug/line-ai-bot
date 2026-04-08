'use strict';

const crypto = require('crypto');
const { supabase } = require('./supabase_service');

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

async function fetchPersistedPanel(userId, hash) {
  const safeUserId = normalizeText(userId);
  const safeHash = normalizeText(hash);
  if (!safeUserId || !safeHash) return null;
  try {
    const { data, error } = await supabase
      .from('lab_documents')
      .select('panel_json')
      .eq('user_id', safeUserId)
      .eq('document_hash', safeHash)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return clone(data?.panel_json || null);
  } catch (_error) {
    return null;
  }
}

async function persistPanel(userId, hash, panel) {
  const safeUserId = normalizeText(userId);
  const safeHash = normalizeText(hash);
  if (!safeUserId || !safeHash || !panel) return false;
  try {
    const payload = {
      user_id: safeUserId,
      document_hash: safeHash,
      document_type: normalizeText(panel.documentType || panel.document_type || ''),
      patient_name: normalizeText(panel.patientName || panel.patient_name || ''),
      report_date: normalizeText(panel.reportDate || '' ) || null,
      latest_exam_date: normalizeText(panel.latestExamDate || panel.examDate || '' ) || null,
      exam_dates: Array.isArray(panel.examDates) ? panel.examDates : [],
      panel_json: panel,
      issues: Array.isArray(panel.issues) ? panel.issues : []
    };
    const { error } = await supabase.from('lab_documents').upsert(payload, { onConflict: 'user_id,document_hash' });
    if (error) throw error;
    return true;
  } catch (_error) {
    return false;
  }
}

async function getCachedPanelByPayload(userId, payload = {}) {
  const hash = hashImagePayload(payload);
  if (!hash) return null;
  const panel = panelByHash.get(hash);
  if (panel && userId) latestHashByUser.set(String(userId), hash);
  if (panel) return clone(panel);
  const persisted = await fetchPersistedPanel(userId, hash);
  if (persisted && userId) latestHashByUser.set(String(userId), hash);
  if (persisted) panelByHash.set(hash, clone({ ...persisted, documentHash: hash }));
  return clone(persisted || null);
}

async function storePanelForPayload(userId, payload = {}, panel = null) {
  const hash = hashImagePayload(payload);
  if (!hash || !panel) return null;
  const stored = clone({ ...panel, documentHash: hash });
  panelByHash.set(hash, stored);
  if (userId) latestHashByUser.set(String(userId), hash);
  await persistPanel(userId, hash, stored);
  return clone(stored);
}


async function storePanelForHash(userId, hash, panel = null) {
  const safeHash = normalizeText(hash);
  if (!safeHash || !panel) return null;
  const stored = clone({ ...panel, documentHash: safeHash });
  panelByHash.set(safeHash, stored);
  if (userId) latestHashByUser.set(String(userId), safeHash);
  await persistPanel(userId, safeHash, stored);
  return clone(stored);
}

async function getLatestPanelForUser(userId) {
  const safeUserId = String(userId || '');
  const hash = latestHashByUser.get(safeUserId);
  if (hash) {
    const local = panelByHash.get(hash);
    if (local) return clone(local);
  }
  try {
    const { data, error } = await supabase
      .from('lab_documents')
      .select('document_hash, panel_json')
      .eq('user_id', safeUserId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data?.document_hash) latestHashByUser.set(safeUserId, data.document_hash);
    if (data?.document_hash && data?.panel_json) panelByHash.set(data.document_hash, clone({ ...data.panel_json, documentHash: data.document_hash }));
    return clone(data?.panel_json || null);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  hashImagePayload,
  getCachedPanelByPayload,
  storePanelForPayload,
  storePanelForHash,
  getLatestPanelForUser
};
