"use strict";

const labDocumentStoreService = require('./lab_document_store_service');
const labFollowupService = require('./lab_followup_service');

function normalizeText(value) {
  return String(value || '').trim();
}

async function answerLabQuery(lineUserId, text, shortMemory = {}) {
  const safe = normalizeText(text);
  if (!safe) return null;
  const panel = shortMemory?.followUpContext?.labPanel || await labDocumentStoreService.getLatestPanelForUser(lineUserId) || null;
  if (!panel) return null;

  if (labFollowupService.shouldHandleTrendQuestion(safe)) {
    return labFollowupService.buildTrendReply(panel, safe);
  }

  const targetName = labFollowupService.normalizeTarget(safe);
  if (!targetName) return null;
  const selectedDate = shortMemory?.followUpContext?.selectedLabExamDate || panel?.latestExamDate || panel?.examDate || '';
  return labFollowupService.buildItemReply(panel, targetName, selectedDate);
}

module.exports = {
  answerLabQuery
};
