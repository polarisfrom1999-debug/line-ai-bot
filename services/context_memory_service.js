'use strict';

const memoryStore = new Map();

function nowIso() {
  return new Date().toISOString();
}

function ensureState(userKey) {
  const key = String(userKey || 'unknown');
  if (!memoryStore.has(key)) {
    memoryStore.set(key, {
      userKey: key,
      turns: [],
      lastImageType: null,
      profileMode: false,
      pendingTopic: null,
      lastNicknameRequest: null,
      lastDailySummaryAt: null,
      updatedAt: nowIso(),
    });
  }
  return memoryStore.get(key);
}

function trimTurns(turns = [], max = 24) {
  return turns.slice(-max);
}

function rememberTurn(userKey, role, text, meta = {}) {
  const state = ensureState(userKey);
  state.turns = trimTurns([
    ...state.turns,
    {
      role: String(role || 'user'),
      text: String(text || '').trim().slice(0, 1000),
      meta: meta || {},
      at: nowIso(),
    },
  ]);
  state.updatedAt = nowIso();
  if (meta && meta.imageType) state.lastImageType = meta.imageType;
  if (meta && meta.pendingTopic) state.pendingTopic = meta.pendingTopic;
  return state;
}

function getRecentTurns(userKey, limit = 8) {
  const state = ensureState(userKey);
  return state.turns.slice(-Math.max(1, limit));
}

function setImageContext(userKey, imageType = null) {
  const state = ensureState(userKey);
  state.lastImageType = imageType || null;
  state.updatedAt = nowIso();
  return state;
}

function getImageContext(userKey) {
  return ensureState(userKey).lastImageType || null;
}

function enableProfileMode(userKey) {
  const state = ensureState(userKey);
  state.profileMode = true;
  state.updatedAt = nowIso();
  return state;
}

function disableProfileMode(userKey) {
  const state = ensureState(userKey);
  state.profileMode = false;
  state.updatedAt = nowIso();
  return state;
}

function isProfileMode(userKey) {
  return !!ensureState(userKey).profileMode;
}

function setPendingTopic(userKey, topic = null) {
  const state = ensureState(userKey);
  state.pendingTopic = topic || null;
  state.updatedAt = nowIso();
  return state;
}

function getPendingTopic(userKey) {
  return ensureState(userKey).pendingTopic || null;
}

function buildRememberedHints(user = {}, extra = {}) {
  const hints = [];
  if (user.display_name) hints.push(`呼び名: ${user.display_name}`);
  if (user.ai_type) hints.push(`AIタイプ: ${user.ai_type}`);
  if (user.target_weight_kg) hints.push(`目標体重: ${user.target_weight_kg}kg`);
  if (user.activity_level) hints.push(`活動量: ${user.activity_level}`);
  if (extra?.latestWeight) hints.push(`最近の体重: ${extra.latestWeight}kg`);
  if (extra?.lastMealLabel) hints.push(`最近の食事: ${extra.lastMealLabel}`);
  if (extra?.recentConcern) hints.push(`最近の気がかり: ${extra.recentConcern}`);
  return hints;
}

module.exports = {
  rememberTurn,
  getRecentTurns,
  setImageContext,
  getImageContext,
  enableProfileMode,
  disableProfileMode,
  isProfileMode,
  setPendingTopic,
  getPendingTopic,
  buildRememberedHints,
};
