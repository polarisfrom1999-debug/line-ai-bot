"use strict";

const labDocumentStoreService = require('./lab_document_store_service');
const labFollowupService = require('./lab_followup_service');
const contextMemoryService = require('./context_memory_service');
const labReportStoreService = require('./lab_report_store_service');
const labItemAliasService = require('./lab_item_alias_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function buildValueReply(item = {}, examDate = '') {
  const label = normalizeText(item?.label || item?.display_name || item?.displayName || '');
  const value = normalizeText(item?.value || item?.value_text || item?.valueText || item?.value_numeric || item?.valueNumeric || '');
  const unit = normalizeText(item?.unit || '');
  if (!value) return '';
  if (examDate) return `${examDate} の検査では、${label || 'この項目'}は ${value}${unit ? ` ${unit}` : ''} でした。`;
  return `${label || 'この項目'}は ${value}${unit ? ` ${unit}` : ''} でした。`;
}

function buildCloseCandidatesReply(cacheItems = {}, fallbackLabel = '') {
  const keys = Object.keys(cacheItems || {});
  if (!keys.length) return `${fallbackLabel || 'その項目'}はこの画像では確認できませんでした。`;
  const labels = keys
    .map((key) => cacheItems[key]?.label || labItemAliasService.canonicalToLabel(key))
    .filter(Boolean)
    .slice(0, 6);
  if (!labels.length) return `${fallbackLabel || 'その項目'}はこの画像では確認できませんでした。`;
  return `${fallbackLabel || 'その項目'}はこの画像では確認できませんでした。見えている候補: ${labels.join(' / ')}`;
}

function readLatestLabCache(shortMemory = {}, panel = null) {
  const cached = shortMemory?.followUpContext?.latestLabCache;
  if (cached && cached.items && typeof cached.items === 'object') return cached;
  const fallbackItems = labItemAliasService.buildLabItemMapFromPanel(panel || {});
  if (!Object.keys(fallbackItems).length) return null;
  return {
    examDate: normalizeText(panel?.latestExamDate || panel?.examDate || ''),
    items: fallbackItems,
    rawText: normalizeText(panel?.rawText || ''),
    updatedAt: ''
  };
}

async function answerLabQuery(lineUserId, text, shortMemory = {}) {
  const safe = normalizeText(text);
  if (!safe) return null;
  const panel = shortMemory?.followUpContext?.labPanel
    || await contextMemoryService.getLatestLabPanel(lineUserId)
    || await labDocumentStoreService.getLatestPanelForUser(lineUserId)
    || null;
  const latestCache = readLatestLabCache(shortMemory, panel);
  if (!panel && !latestCache) return null;

  const canonicalFromQuestion = labItemAliasService.normalizeLabCanonicalKey(safe);
  const targetName = labFollowupService.normalizeTarget(safe);
  console.info('[lab-qna] question', {
    userId: lineUserId,
    question: safe,
    normalizedKey: canonicalFromQuestion || '',
    latestCacheExists: Boolean(latestCache)
  });

  if (canonicalFromQuestion && latestCache?.items?.[canonicalFromQuestion]) {
    const hit = latestCache.items[canonicalFromQuestion];
    console.info('[lab-qna] cache hit', {
      userId: lineUserId,
      normalizedKey: canonicalFromQuestion,
      matchedLabel: hit?.label || ''
    });
    return buildValueReply(hit, latestCache.examDate || '');
  }

  if (canonicalFromQuestion && latestCache?.items && !latestCache.items[canonicalFromQuestion]) {
    console.info('[lab-qna] cache miss', {
      userId: lineUserId,
      normalizedKey: canonicalFromQuestion,
      availableKeys: Object.keys(latestCache.items || {})
    });
  }

  // 質問から canonical key が取れていれば、targetName が弱くても DB 直接検索を行う
  if (canonicalFromQuestion) {
    const latestTwo = await labReportStoreService.getLatestTwoItemsForUser(lineUserId, canonicalFromQuestion);
    if (latestTwo.length) {
      const latest = latestTwo[0];
      const previous = latestTwo[1] || null;
      const latestLabel = `${latest.value_text || latest.value_numeric}${latest.unit ? ` ${latest.unit}` : ''}`;
      if (!previous) {
        return `${latest.display_name || labItemAliasService.canonicalToLabel(canonicalFromQuestion)} は ${latest.exam_date || '最新'} で ${latestLabel} です。`;
      }
      const prevLabel = `${previous.value_text || previous.value_numeric}${previous.unit ? ` ${previous.unit}` : ''}`;
      const nowNum = Number(latest.value_numeric);
      const prevNum = Number(previous.value_numeric);
      if (Number.isFinite(nowNum) && Number.isFinite(prevNum)) {
        const delta = Math.round((nowNum - prevNum) * 10) / 10;
        const tendency = delta > 0 ? '上がり傾向' : delta < 0 ? '下がり傾向' : '横ばい';
        return [
          `${latest.display_name || labItemAliasService.canonicalToLabel(canonicalFromQuestion)} は ${latest.exam_date || '最新'} で ${latestLabel} です。`,
          `前回 ${previous.exam_date || '前回'} は ${prevLabel} で、差は ${delta > 0 ? '+' : ''}${delta}${latest.unit ? ` ${latest.unit}` : ''}（${tendency}）です。`
        ].join('\n');
      }
      return `${latest.display_name || labItemAliasService.canonicalToLabel(canonicalFromQuestion)} は ${latest.exam_date || '最新'} で ${latestLabel}、前回 ${previous.exam_date || '前回'} は ${prevLabel} です。`;
    }
  }

  if (targetName) {
    const canonical = labReportStoreService.toCanonicalName(targetName);
    if (canonical) {
      const latestTwo = await labReportStoreService.getLatestTwoItemsForUser(lineUserId, canonical);
      if (latestTwo.length) {
        const latest = latestTwo[0];
        const previous = latestTwo[1] || null;
        const latestLabel = `${latest.value_text || latest.value_numeric}${latest.unit ? ` ${latest.unit}` : ''}`;
        if (!previous) {
          return `${latest.display_name || targetName} は ${latest.exam_date || '最新'} で ${latestLabel} です。`;
        }
        const prevLabel = `${previous.value_text || previous.value_numeric}${previous.unit ? ` ${previous.unit}` : ''}`;
        const nowNum = Number(latest.value_numeric);
        const prevNum = Number(previous.value_numeric);
        if (Number.isFinite(nowNum) && Number.isFinite(prevNum)) {
          const delta = Math.round((nowNum - prevNum) * 10) / 10;
          const tendency = delta > 0 ? '上がり傾向' : delta < 0 ? '下がり傾向' : '横ばい';
          return [
            `${latest.display_name || targetName} は ${latest.exam_date || '最新'} で ${latestLabel} です。`,
            `前回 ${previous.exam_date || '前回'} は ${prevLabel} で、差は ${delta > 0 ? '+' : ''}${delta}${latest.unit ? ` ${latest.unit}` : ''}（${tendency}）です。`
          ].join('\n');
        }
        return `${latest.display_name || targetName} は ${latest.exam_date || '最新'} で ${latestLabel}、前回 ${previous.exam_date || '前回'} は ${prevLabel} です。`;
      }
    }

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
    const hintCanonical = labReportStoreService.toCanonicalName(safe);
    if (hintCanonical) {
      const trendRows = await labReportStoreService.getRecentTrendForUser(lineUserId, hintCanonical, 5);
      if (trendRows.length >= 2) {
        const latest = trendRows[0];
        const oldest = trendRows[trendRows.length - 1];
        const nowNum = Number(latest.value_numeric);
        const oldNum = Number(oldest.value_numeric);
        if (Number.isFinite(nowNum) && Number.isFinite(oldNum)) {
          const delta = Math.round((nowNum - oldNum) * 10) / 10;
          const tendency = delta > 0 ? '上がり傾向' : delta < 0 ? '下がり傾向' : '横ばい';
          const path = [...trendRows]
            .reverse()
            .map((row) => `${row.exam_date || '-'} ${row.value_text || row.value_numeric}`)
            .join(' / ');
          return [
            `${latest.display_name || hintCanonical} は全体として ${tendency} です。`,
            `最新 ${latest.exam_date || '最新'}: ${latest.value_text || latest.value_numeric}${latest.unit ? ` ${latest.unit}` : ''} / 初回 ${oldest.exam_date || '初回'}: ${oldest.value_text || oldest.value_numeric}${oldest.unit ? ` ${oldest.unit}` : ''}`,
            `流れ: ${path}`
          ].join('\n');
        }
      }
    }

    const trend = labFollowupService.buildTrendReply(panel || {}, safe);
    if (trend && !/まだ傾向を安定してまとめ切れていません/.test(trend)) return trend;
  }

  if (!targetName && !canonicalFromQuestion) return null;
  if (targetName && panel) {
    const selectedDate = shortMemory?.followUpContext?.selectedLabExamDate || panel?.latestExamDate || panel?.examDate || '';
    return labFollowupService.buildItemReply(panel, targetName, selectedDate);
  }
  return buildCloseCandidatesReply(latestCache?.items || {}, targetName || labItemAliasService.canonicalToLabel(canonicalFromQuestion));
}

module.exports = {
  answerLabQuery
};
