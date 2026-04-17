"use strict";

const labDocumentStoreService = require('./lab_document_store_service');
const labFollowupService = require('./lab_followup_service');
const contextMemoryService = require('./context_memory_service');
const labReportStoreService = require('./lab_report_store_service');
const labItemAliasService = require('./lab_item_alias_service');

function normalizeText(value) {
  return String(value || '').trim();
}

const COMPARE_KEYS = ['TG', 'HBA1C', 'LDL', 'HDL', 'GLU', 'AST', 'ALT', 'WBC'];

function hasExplicitLabItemMention(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (labItemAliasService.normalizeLabCanonicalKey(safe)) return true;
  if (labFollowupService.normalizeTarget(safe)) return true;
  return false;
}

function isOverallLabCompareQuestion(text) {
  const safe = normalizeText(text);
  if (!safe || hasExplicitLabItemMention(safe)) return false;
  return /前回より|前回と(比べ|比較|くらべ)|前と(比べ|比較|くらべ)|前回はどう|まとめてどう|全体(的)?どう|検査(結果)?の流れ|結果はどう/.test(safe);
}

function formatRowBrief(row) {
  if (!row) return '';
  const v = normalizeText(row.value_text || row.value_numeric || '');
  const u = normalizeText(row.unit || '');
  return v ? `${v}${u ? ` ${u}` : ''}` : '';
}

async function buildOverallLabCompareReply(userId) {
  const { dates, byDate } = await labReportStoreService.getLatestTwoExamSnapshots(userId);
  if (dates.length < 2) {
    return dates.length === 1
      ? `いま保存できている検査日は ${dates[0]} だけです。前回比には、もう1回分の検査画像を送ってもらえると出せます。`
      : 'まだ比較できる検査データが足りません。血液検査の画像を1枚送ってもらえると、日付つきで整理します。';
  }
  const [latestD, prevD] = dates;
  const lines = [];
  for (const key of COMPARE_KEYS) {
    const cur = byDate[latestD]?.[key];
    const prev = byDate[prevD]?.[key];
    if (!cur && !prev) continue;
    const label = cur?.display_name || prev?.display_name || labItemAliasService.canonicalToLabel(key.toLowerCase()) || key;
    const curV = formatRowBrief(cur);
    const prevV = formatRowBrief(prev);
    if (curV && prevV) {
      const a = Number(cur.value_numeric);
      const b = Number(prev.value_numeric);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const delta = Math.round((a - b) * 10) / 10;
        const dir = delta > 0 ? '上がっています' : delta < 0 ? '下がっています' : 'ほぼ同じです';
        lines.push(`${label}: 今回 ${curV} / 前回 ${prevV}（差 ${delta > 0 ? '+' : ''}${delta}、${dir}）`);
      } else {
        lines.push(`${label}: 今回 ${curV} / 前回 ${prevV}`);
      }
    } else if (curV) {
      lines.push(`${label}: 今回 ${curV}（前回はデータなし）`);
    }
  }
  if (!lines.length) {
    return `${latestD} と ${prevD} の2回分はあるのですが、主要項目の数値がまだ拾えていません。「TGは？」のように項目名で聞いてもらえると返しやすいです。`;
  }
  return [`直近の検査を ${prevD} → ${latestD} で比べると、`, ...lines.slice(0, 5)].join('\n');
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
  const panelItems = labItemAliasService.buildLabItemMapFromPanel(panel || {});
  const panelKeys = Object.keys(panelItems);

  // items が {} のときも truthy になり得るため、キーが無ければパネル由来で補完する
  if (cached && cached.items && typeof cached.items === 'object') {
    const cacheKeys = Object.keys(cached.items);
    if (cacheKeys.length > 0) return cached;
    if (panelKeys.length > 0) {
      return {
        ...cached,
        examDate: normalizeText(cached.examDate || panel?.latestExamDate || panel?.examDate || ''),
        items: { ...panelItems },
        rawText: normalizeText(cached.rawText || panel?.rawText || '')
      };
    }
    return cached;
  }

  if (!Object.keys(panelItems).length) return null;
  return {
    examDate: normalizeText(panel?.latestExamDate || panel?.examDate || ''),
    items: panelItems,
    rawText: normalizeText(panel?.rawText || ''),
    updatedAt: ''
  };
}

async function answerLabQuery(lineUserId, text, shortMemory = {}) {
  const safe = normalizeText(text);
  if (!safe) return null;

  if (isOverallLabCompareQuestion(safe)) {
    return buildOverallLabCompareReply(lineUserId);
  }

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
