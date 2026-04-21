'use strict';

const labDocumentStoreService = require('./lab_document_store_service');
const labFollowupService = require('./lab_followup_service');
const contextMemoryService = require('./context_memory_service');
const labReportStoreService = require('./lab_report_store_service');
const labItemAliasService = require('./lab_item_alias_service');

function normalizeText(value) {
  return String(value || '').trim();
}

const ALLOWED_FOLLOW_TARGETS = new Set(['LDL', 'HDL', 'HbA1c', '中性脂肪', 'AST', 'ALT', '血糖', 'クレアチニン']);
const ALLOWED_CANONICAL_KEYS = new Set(['ldl', 'hdl', 'tg', 'hba1c', 'ast', 'alt', 'glu', 'cr']);

/**
 * lab-qna に入れてはいけない一般会話・他ドメイン
 */
function isNonLabQuestionForLabQna(safe) {
  if (/食事|カロリー|kcal|キロカロリー|食べた|メニュー|何食べ|摂取.*食|合計.*食/.test(safe)) return true;
  if (/運動|消費カロ|歩数|筋トレ/.test(safe)) return true;
  if (/体重|体脂肪/.test(safe)) return true;
  if (/週間報告|月間報告|今週の食|週間.*食|週間.*カロリー/.test(safe)) return true;
  if (/データがおかしい|おかしくないか|ずれてる|重複|件数がおかしい/.test(safe)) return true;
  if (/記録を修正|再計算|昨日の分|昨晩|一昨日/.test(safe)) return true;
  if ((/詳細|内訳|一覧/.test(safe)) && !/(血液|検査|LDL|TG|HbA1c|脂質|肝|腎|項目|中性脂肪)/i.test(safe)) return true;
  return false;
}

/**
 * lab-qna に通す血液検査 follow-up のみ（ホワイトリスト）
 */
function isStrictLabQnaQuestion(safe) {
  if (/日付は|いつ[？?]|検査日|採血日は/.test(safe)) return true;
  if (/読み取れた記録|他に読めたのは|他に読めた|拾えてる項目|他に(?:は)?読め/.test(safe)) return true;
  const nt = labFollowupService.normalizeTarget(safe);
  if (nt && ALLOWED_FOLLOW_TARGETS.has(nt)) return true;
  const k = labItemAliasService.normalizeLabCanonicalKey(safe);
  if (k && ALLOWED_CANONICAL_KEYS.has(k)) return true;
  return false;
}

function buildValueReply(item = {}, examDate = '') {
  const label = normalizeText(item?.label || item?.display_name || item?.displayName || '');
  const value = normalizeText(item?.value || item?.value_text || item?.valueText || item?.value_numeric || item?.valueNumeric || '');
  const unit = normalizeText(item?.unit || '');
  if (!value) return '';
  if (examDate) return `${examDate} の検査では、${label || 'この項目'}は ${value}${unit ? ` ${unit}` : ''} でした。`;
  return `${label || 'この項目'}は ${value}${unit ? ` ${unit}` : ''} でした。`;
}

function readLatestLabCache(shortMemory = {}, panel = null) {
  const cached = shortMemory?.followUpContext?.latestLabCache;
  const panelItems = labItemAliasService.buildLabItemMapFromPanel(panel || {});
  const panelKeys = Object.keys(panelItems);

  if (cached && cached.items && typeof cached.items === 'object') {
    const cacheKeys = Object.keys(cached.items);
    if (cacheKeys.length > 0) {
      return {
        ...cached,
        rawText: normalizeText(cached.rawText || panel?.rawText || '')
      };
    }
    const raw = normalizeText(cached.rawText || panel?.rawText || '');
    const fromRaw = raw ? labItemAliasService.buildLabItemMapFromRawText(raw) : {};
    if (Object.keys(fromRaw).length > 0) {
      return {
        ...cached,
        examDate: normalizeText(cached.examDate || panel?.latestExamDate || panel?.examDate || ''),
        items: { ...fromRaw },
        rawText: raw
      };
    }
    if (panelKeys.length > 0) {
      return {
        ...cached,
        examDate: normalizeText(cached.examDate || panel?.latestExamDate || panel?.examDate || ''),
        items: { ...panelItems },
        rawText: normalizeText(cached.rawText || panel?.rawText || '')
      };
    }
    return { ...cached, rawText: raw };
  }

  if (!Object.keys(panelItems).length) return null;
  return {
    examDate: normalizeText(panel?.latestExamDate || panel?.examDate || ''),
    items: panelItems,
    rawText: normalizeText(panel?.rawText || ''),
    updatedAt: ''
  };
}

function syntheticPanelFromSession(shortMemory, latestCache) {
  const base = shortMemory?.followUpContext?.labPanel || {};
  const fromMap = latestCache?.items || {};
  const syntheticItems = Object.entries(fromMap).map(([, v]) => ({
    itemName: v.label || v.rawLabel || '',
    value: v.value,
    unit: v.unit || ''
  }));
  const items = Array.isArray(base.items) && base.items.length ? base.items : syntheticItems;
  return {
    ...base,
    items,
    rawText: normalizeText(latestCache?.rawText || base.rawText || ''),
    examDate: latestCache?.examDate || base.examDate,
    latestExamDate: latestCache?.examDate || base.latestExamDate || base.examDate
  };
}

async function resolveCanonicalWithFallbacks(lineUserId, canonical, latestCache, sessionPanel) {
  const availableKeys = Object.keys(latestCache?.items || {});
  let dbPanelHadKeys = [];

  if (canonical && latestCache?.items?.[canonical]) {
    return {
      source: 'latestCache.items',
      item: latestCache.items[canonical],
      examDate: latestCache.examDate || ''
    };
  }

  const rawOnly = labItemAliasService.buildLabItemMapFromRawText(latestCache?.rawText || '');
  if (canonical && rawOnly[canonical]) {
    return {
      source: 'latestCache.rawText_reparse',
      item: rawOnly[canonical],
      examDate: latestCache?.examDate || ''
    };
  }

  const dbPanel = (await contextMemoryService.getLatestLabPanel(lineUserId))
    || (await labDocumentStoreService.getLatestPanelForUser(lineUserId))
    || null;
  const dbMap = labItemAliasService.buildLabItemMapFromPanel(dbPanel || {});
  dbPanelHadKeys = Object.keys(dbMap);
  if (canonical && dbMap[canonical]) {
    return {
      source: 'db_latest_lab_panel',
      item: dbMap[canonical],
      examDate: normalizeText(latestCache?.examDate || dbPanel?.latestExamDate || dbPanel?.examDate || '')
    };
  }

  const examDate = normalizeText(latestCache?.examDate || '');
  if (canonical && examDate) {
    const row = await labReportStoreService.getLatestItemForUserOnExamDate(lineUserId, canonical, examDate);
    if (row) {
      const value = normalizeText(row.value_text || String(row.value_numeric ?? ''));
      if (value) {
        return {
          source: 'db_same_exam_date',
          item: {
            label: row.display_name || labItemAliasService.canonicalToLabel(canonical),
            value,
            unit: normalizeText(row.unit || '')
          },
          examDate: row.exam_date || examDate
        };
      }
    }
  }

  return {
    source: 'miss',
    item: null,
    examDate: latestCache?.examDate || '',
    availableKeys,
    dbPanelHadKeys
  };
}

async function answerLabQuery(lineUserId, text, shortMemory = {}) {
  const safe = normalizeText(text);
  if (!safe) return null;

  if (isNonLabQuestionForLabQna(safe)) {
    console.info('[lab-qna] reject', { reason: 'non_lab_question', question: safe });
    return null;
  }

  const memCache = shortMemory?.followUpContext?.latestLabCache;
  const latestCacheExists = Boolean(memCache && typeof memCache === 'object');

  if (!isStrictLabQnaQuestion(safe)) {
    console.info('[lab-qna] reject', {
      reason: 'not_whitelisted_lab_followup',
      question: safe,
      latestCacheExists
    });
    return null;
  }

  if (!latestCacheExists) {
    console.info('[lab-qna] reject', {
      reason: 'no_latest_lab_cache_session',
      question: safe,
      hint: 'need_lab_image_session_short_memory'
    });
    return null;
  }

  const sessionPanel = shortMemory?.followUpContext?.labPanel || null;
  let latestCache = readLatestLabCache(shortMemory, sessionPanel);
  if (!latestCache) {
    console.info('[lab-qna] reject', { reason: 'readLatestLabCache_empty', question: safe });
    return null;
  }

  const canonicalFromQuestion = labItemAliasService.normalizeLabCanonicalKey(safe);
  const targetName = labFollowupService.normalizeTarget(safe);
  const availableAfterRead = Object.keys(latestCache.items || {});

  console.info('[lab-qna] enter', {
    reason: 'whitelist_and_lab_image_session',
    userId: lineUserId,
    question: safe,
    normalizedKey: canonicalFromQuestion || '',
    targetName: targetName || '',
    latestCacheExists: true,
    availableKeys: availableAfterRead,
    rawTextPresent: Boolean(normalizeText(latestCache.rawText || '')),
    examDate: latestCache.examDate || ''
  });

  if (/読み取れた記録|他に読めたのは|他に読めた|拾えてる項目|他に(?:は)?読め/.test(safe)) {
    const p = syntheticPanelFromSession(shortMemory, latestCache);
    return labFollowupService.buildReadableInventoryReply(p);
  }

  if (/日付は|いつ[？?]|検査日|採血日は/.test(safe)) {
    const p = syntheticPanelFromSession(shortMemory, latestCache);
    return labFollowupService.buildExamDateQuickReply(p);
  }

  const canonical = canonicalFromQuestion
    || (targetName ? labItemAliasService.normalizeLabCanonicalKey(targetName) : '');
  if (!canonical || !ALLOWED_CANONICAL_KEYS.has(canonical)) {
    console.info('[lab-qna] reject', {
      reason: 'no_allowed_item_key_in_question',
      question: safe,
      normalizedKey: canonical || ''
    });
    return null;
  }

  const resolved = await resolveCanonicalWithFallbacks(lineUserId, canonical, latestCache, sessionPanel);
  if (resolved.item && resolved.source !== 'miss') {
    console.info('[lab-qna] resolved', {
      userId: lineUserId,
      normalizedKey: canonical,
      source: resolved.source,
      availableKeys: availableAfterRead
    });
    return buildValueReply(resolved.item, resolved.examDate || '');
  }

  const label = labItemAliasService.canonicalToLabel(canonical) || canonical;
  const examPart = resolved.examDate ? `（${resolved.examDate}）` : '';
  console.info('[lab-qna] miss_all_fallbacks', {
    userId: lineUserId,
    normalizedKey: canonical,
    availableKeys: resolved.availableKeys || [],
    dbPanelKeysSample: (resolved.dbPanelHadKeys || []).slice(0, 12)
  });
  return `今回は検査日${examPart}までは読めていますが、${label} の数値の保存・抽出がまだ十分でないため、この場ではお伝えできません。画像をもう一度送るか、紙の数値を書いてください。`;
}

module.exports = {
  answerLabQuery
};
