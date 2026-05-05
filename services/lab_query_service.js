'use strict';

const labDocumentStoreService = require('./lab_document_store_service');
const labFollowupService = require('./lab_followup_service');
const contextMemoryService = require('./context_memory_service');
const labReportStoreService = require('./lab_report_store_service');
const labItemAliasService = require('./lab_item_alias_service');
const labResultItemsReader = require('./newflow/lab_result_items_reader_service');
const canonicalFallbackService = require('./newflow/canonical_fallback_service');
const labResultItemRepository = require('../repositories/lab_result_item_repository');

function normalizeText(value) {
  return String(value || '').trim();
}

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
    latestExamDate: latestCache?.examDate || base.latestExamDate || base.examDate,
    patientName: normalizeText(latestCache?.patientName || base.patientName || ''),
    facilityName: normalizeText(latestCache?.facilityName || base.facilityName || ''),
    printDate: normalizeText(latestCache?.printDate || base.printDate || ''),
    examDates: Array.isArray(latestCache?.examDates) && latestCache.examDates.length
      ? latestCache.examDates
      : (Array.isArray(base?.examDates) ? base.examDates : [])
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

  let sessionPanel = shortMemory?.followUpContext?.labPanel || null;
  if (!sessionPanel) {
    sessionPanel = (await contextMemoryService.getLatestLabPanel(lineUserId))
      || (await labDocumentStoreService.getLatestPanelForUser(lineUserId))
      || null;
  }
  let latestCache = readLatestLabCache(shortMemory, sessionPanel);
  if (!latestCache && sessionPanel && typeof sessionPanel === 'object') {
    const pm = labItemAliasService.buildLabItemMapFromPanel(sessionPanel);
    latestCache = {
      items: pm,
      examDate: normalizeText(sessionPanel?.latestExamDate || sessionPanel?.examDate || ''),
      rawText: normalizeText(sessionPanel?.rawText || ''),
      patientName: normalizeText(sessionPanel?.patientName || ''),
      facilityName: normalizeText(sessionPanel?.facilityName || ''),
      printDate: normalizeText(sessionPanel?.printDate || ''),
      examDates: Array.isArray(sessionPanel?.examDates) ? sessionPanel.examDates : [],
    };
  }
  if (!latestCache) {
    console.info('[lab-qna] miss', { reason: 'no_lab_context', question: safe, latestCacheExists });
    return 'この会話にはまだ検査データがつながっていないみたい。検査の画像を送ってもらえる？ひとことで「検査」と添えてもらえると助かるよ。';
  }

  const canonicalFromQuestion = labItemAliasService.normalizeLabCanonicalKey(safe);
  const targetName = labFollowupService.normalizeTarget(safe);
  const availableAfterRead = Object.keys(latestCache.items || {});

  console.info('[lab-qna] enter', {
    userId: lineUserId,
    question: safe,
    normalizedKey: canonicalFromQuestion || '',
    targetName: targetName || '',
    latestCacheExists: true,
    availableKeys: availableAfterRead,
    rawTextPresent: Boolean(normalizeText(latestCache.rawText || '')),
    examDate: latestCache.examDate || ''
  });

  if (/悪い値|危ない値|異常そう|問題ありそう|大丈夫そう/.test(safe)) {
    const p = syntheticPanelFromSession(shortMemory, latestCache);
    return labFollowupService.buildAbnormalItemsReply(p);
  }
  if (/数値全部|ぜんぶ教えて|全部.*教え|一覧.*数値|数値を.*並べ/.test(safe)) {
    const p = syntheticPanelFromSession(shortMemory, latestCache);
    return labFollowupService.buildNaturalAllValuesReply(p);
  }

  if (/読み取れた記録|他に読めたのは|他に読めた|拾えてる項目|他に(?:は)?読め/.test(safe)) {
    const p = syntheticPanelFromSession(shortMemory, latestCache);
    return labFollowupService.buildReadableInventoryReply(p);
  }

  if (/患者名|氏名/.test(safe)) {
    const p = syntheticPanelFromSession(shortMemory, latestCache);
    return labFollowupService.buildPatientNameReply(p);
  }

  if (/病院名|医院名|クリニック名|医療機関/.test(safe)) {
    const p = syntheticPanelFromSession(shortMemory, latestCache);
    return labFollowupService.buildFacilityNameReply(p);
  }

  if (/印刷日|発行日|出力日/.test(safe)) {
    const p = syntheticPanelFromSession(shortMemory, latestCache);
    return labFollowupService.buildPrintDateReply(p);
  }

  if (/一番新しい日付|最新日|最新の検査日/.test(safe)) {
    const p = syntheticPanelFromSession(shortMemory, latestCache);
    return labFollowupService.buildLatestDateReply(p);
  }

  if (/異常がついている項目|異常項目|H\/L|ハイフラグ|ローフラグ/.test(safe)) {
    const p = syntheticPanelFromSession(shortMemory, latestCache);
    return labFollowupService.buildAbnormalItemsReply(p);
  }

  if (/日付は|いつ[？?]|検査日|採血日は/.test(safe)) {
    const p = syntheticPanelFromSession(shortMemory, latestCache);
    return labFollowupService.buildExamDateQuickReply(p);
  }

  const canonical = canonicalFromQuestion
    || (targetName ? labItemAliasService.normalizeLabCanonicalKey(targetName) : '');
  if (!canonical && !targetName) {
    const p = syntheticPanelFromSession(shortMemory, latestCache);
    return labFollowupService.buildReadableInventoryReply(p);
  }

  const currentSessionId = shortMemory?.followUpContext?.latestLabCache?.sourceSessionId
    || shortMemory?.followUpContext?.labSessionId
    || null;
  let canonicalFallbackSessionId = null;
  const latestResultItemsSessionId = await labResultItemRepository.getLatestLabSessionIdByUser({
    userId: lineUserId
  }).catch(() => null);
  let selectedSessionId = latestResultItemsSessionId || null;
  let selectedReason = latestResultItemsSessionId ? 'latest_lab_result_items_session' : '';
  if (!selectedSessionId && currentSessionId) {
    const currentPack = await labResultItemRepository.fetchBySessionForFollowup({
      lineUserId: lineUserId,
      labSessionId: Number(currentSessionId),
      excludeValidation: ['rejected', 'superseded']
    }).catch(() => ({ rows: [] }));
    if (Array.isArray(currentPack?.rows) && currentPack.rows.length) {
      selectedSessionId = Number(currentSessionId);
      selectedReason = 'current_session_with_result_items';
    }
  }
  if (!selectedSessionId) {
    const canonicalPanel = await canonicalFallbackService.getCanonicalLabPanel(lineUserId).catch(() => null);
    canonicalFallbackSessionId = canonicalPanel?.sourceSessionId || null;
    selectedSessionId = canonicalFallbackSessionId || null;
    selectedReason = selectedSessionId ? 'canonical_fallback_session' : '';
  } else if (currentSessionId && Number(currentSessionId) === Number(selectedSessionId)) {
    selectedReason = 'current_session_has_latest_lab_result_items';
  }
  console.info('[lab_followup_session_resolution]', {
    user_id: lineUserId,
    requested_text: safe.slice(0, 200),
    canonical_fallback_session_id: canonicalFallbackSessionId,
    latest_result_items_session_id: latestResultItemsSessionId,
    selected_lab_result_items_session_id: selectedSessionId,
    reason: selectedReason || 'no_session_selected'
  });
  if (selectedSessionId) {
    const selectedDate = normalizeText(latestCache?.examDate || '');
    const readerTargetLabel = targetName || canonical || safe;
    const fr = await labResultItemsReader.buildItemFollowupReplyFromResults({
      lineUserId: lineUserId,
      userId: lineUserId,
      labSessionId: selectedSessionId,
      targetLabel: readerTargetLabel,
      selectedDate
    }).catch(() => null);
    if (fr?.replyText) {
      labResultItemsReader.logResultItemsSource({
        question: safe.slice(0, 400),
        detected_item_label: targetName || canonical,
        canonical_normalized_key: fr.canonical_normalized_key || canonical,
        selected_lab_session_id: selectedSessionId,
        answer_source_session_id: selectedSessionId,
        used_source: fr.usedSource === 'lab_result_items_label_fallback' ? 'lab_result_items_label_fallback' : 'lab_result_items',
        result_count: 1,
        fallback_reason: null
      });
      return fr.replyText;
    }
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
