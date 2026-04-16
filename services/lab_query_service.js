"use strict";

const labDocumentStoreService = require('./lab_document_store_service');
const labFollowupService = require('./lab_followup_service');
const contextMemoryService = require('./context_memory_service');

function normalizeText(value) {
  return String(value || '').trim();
}

async function answerLabQuery(lineUserId, text, shortMemory = {}) {
  const safe = normalizeText(text);
  if (!safe) return null;
  const panel = shortMemory?.followUpContext?.labPanel
    || await contextMemoryService.getLatestLabPanel(lineUserId)
    || await labDocumentStoreService.getLatestPanelForUser(lineUserId)
    || null;
  if (!panel) return null;

  const targetName = labFollowupService.normalizeTarget(safe);
  if (targetName) {
    const history = await contextMemoryService.findLabItemTrend(lineUserId, targetName);
    if (history.length) {
      const latest = history[history.length - 1];
      const previous = history.length >= 2 ? history[history.length - 2] : null;
      const latestLabel = `${latest.value}${latest.unit ? ` ${latest.unit}` : ''}${latest.flag ? ` ${latest.flag}` : ''}`;
      if (!previous) return `${targetName} は最新で ${latest.date} に ${latestLabel} です。`;

      const prevLabel = `${previous.value}${previous.unit ? ` ${previous.unit}` : ''}${previous.flag ? ` ${previous.flag}` : ''}`;
      const nowNum = Number(latest.value);
      const prevNum = Number(previous.value);
      if (Number.isFinite(nowNum) && Number.isFinite(prevNum)) {
        const delta = Math.round((nowNum - prevNum) * 10) / 10;
        const tendency = delta > 0 ? '高め傾向' : delta < 0 ? '改善傾向' : '横ばい';
        return [
          `${targetName} は最新 ${latest.date} で ${latestLabel} です。`,
          `前回 ${previous.date} は ${prevLabel} なので、差は ${delta > 0 ? '+' : ''}${delta}${latest.unit ? ` ${latest.unit}` : ''}（${tendency}）です。`
        ].join('\n');
      }
      return `${targetName} は最新 ${latest.date} で ${latestLabel}、前回 ${previous.date} は ${prevLabel} です。`;
    }
  }

  if (labFollowupService.shouldHandleTrendQuestion(safe)) {
    const trend = labFollowupService.buildTrendReply(panel, safe);
    if (trend && !/まだ傾向を安定してまとめ切れていません/.test(trend)) return trend;
  }

  if (!targetName) return null;
  const selectedDate = shortMemory?.followUpContext?.selectedLabExamDate || panel?.latestExamDate || panel?.examDate || '';
  return labFollowupService.buildItemReply(panel, targetName, selectedDate);
}

module.exports = {
  answerLabQuery
};
