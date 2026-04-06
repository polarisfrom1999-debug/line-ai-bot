"use strict";

const labDocumentStoreService = require('./lab_document_store_service');
const labFollowupService = require('./lab_followup_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function isPanelReady(panel, shortMemory = {}) {
  if (!panel) return false;
  const fromMemory = shortMemory?.followUpContext?.labPanelReady;
  if (fromMemory === false) return false;
  const items = Array.isArray(panel?.items) ? panel.items : [];
  return items.some((item) => {
    const history = Array.isArray(item?.history) ? item.history.filter((row) => normalizeText(row?.date) && normalizeText(row?.value)) : [];
    return normalizeText(item?.value || '') || history.length;
  });
}

async function answerLabQuery(lineUserId, text, shortMemory = {}) {
  const safe = normalizeText(text);
  if (!safe) return null;
  const panel = shortMemory?.followUpContext?.labPanel || await labDocumentStoreService.getLatestPanelForUser(lineUserId) || null;
  if (!panel) return null;
  if (!isPanelReady(panel, shortMemory)) {
    const targetName = labFollowupService.normalizeTarget(safe);
    if (!targetName && !labFollowupService.shouldHandleTrendQuestion(safe)) return null;
    return '血液検査はまだ保存用の整理が終わっていないので、今は値を断定せず保持しています。保存が安定したら、その後は保存済みデータから返します。';
  }

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
