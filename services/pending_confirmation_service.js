'use strict';

const contextMemoryService = require('./context_memory_service');

function normalizeText(v) {
  return String(v || '').trim();
}

async function savePendingConfirmation(userId, payload = {}) {
  await contextMemoryService.saveShortMemory(userId, {
    pendingConfirmation: {
      createdAt: new Date().toISOString(),
      payload
    }
  });
}

async function readPendingConfirmation(userId) {
  const short = await contextMemoryService.getShortMemory(userId);
  return short?.pendingConfirmation || null;
}

function isConfirmationPositive(text) {
  const safe = normalizeText(text);
  return /^(はい|ok|OK|了解|お願いします|それで|うん|yes)$/i.test(safe);
}

async function clearPendingConfirmation(userId) {
  await contextMemoryService.saveShortMemory(userId, { pendingConfirmation: null });
}

module.exports = {
  savePendingConfirmation,
  readPendingConfirmation,
  isConfirmationPositive,
  clearPendingConfirmation,
};

