'use strict';

const stateMap = new Map();

function getConversationState(userId) {
  if (!userId) return null;

  const current = stateMap.get(userId) || null;
  if (!current) return null;

  if (current.expiresAt && new Date(current.expiresAt).getTime() < Date.now()) {
    stateMap.delete(userId);
    return null;
  }

  return current;
}

function setConversationState(userId, patch = {}, ttlMinutes = 120) {
  if (!userId) return null;

  const current = stateMap.get(userId) || {};
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
  };

  stateMap.set(userId, next);
  return next;
}

function clearConversationState(userId) {
  if (!userId) return;
  stateMap.delete(userId);
}

module.exports = {
  getConversationState,
  setConversationState,
  clearConversationState,
};
