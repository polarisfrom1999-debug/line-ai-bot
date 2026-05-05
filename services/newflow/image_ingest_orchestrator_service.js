'use strict';

const { decideImageDomain } = require('./image_domain_router_service');
const activeContextStoreService = require('./active_context_store_service');
const imageIngestService = require('../image_ingest_service');
const mealAnalysisService = require('../meal_analysis_service');
const labDocumentIngestService = require('../lab_document_ingest_service');
const labSessionRepository = require('../../repositories/lab_session_repository');
const mealRecalcRepository = require('../../repositories/meal_recalc_repository');
const contextMemoryService = require('../context_memory_service');
const mealReplyFormatterService = require('../meal_reply_formatter_service');
const dailyNutritionSummaryService = require('../daily_nutrition_summary_service');
const dailyEnergyBalanceService = require('../daily_energy_balance_service');
const phaseeReachabilityService = require('../phasee_reachability_service');
const labIngestTrace = require('../lab_ingest_trace_service');
const {
  countPersistableParsedRecords,
  extractPrimaryGeminiMinItems,
  distinctObservedDateStringsFromParsedItems,
  examDatesStringArrayForInsert,
  UNKNOWN_OBSERVED_DATE
} = require('../lab_gemini_items_service');
const { normalizeDateToken: normalizeLabDateToken } = require('../lab_document_classifier_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function toParsedItemsFromLabPanel(lab = {}) {
  if (Array.isArray(lab?.itemsStructured) && lab.itemsStructured.length) {
    return lab.itemsStructured;
  }
  if (Array.isArray(lab?.items) && lab.items.length) {
    return lab.items;
  }
  return [];
}

function recoverParsedItemsFromStructuredJson(lab = {}) {
  const structured = (lab?.structuredJson && typeof lab.structuredJson === 'object')
    ? lab.structuredJson
    : ((lab?.rawPayload && typeof lab.rawPayload === 'object') ? lab.rawPayload : null);
  if (!structured) return [];
  return extractPrimaryGeminiMinItems(structured);
}

function buildImageMealRecordPayload(parsedMeal, input = {}) {
  const items = Array.isArray(parsedMeal?.items) ? parsedMeal.items.filter(Boolean) : [];
  const itemLabel = items.length ? items.join('、') : '食事写真';
  return {
    type: 'meal',
    date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    name: itemLabel,
    summary: itemLabel,
    items,
    food_items: items,
    estimatedNutrition: parsedMeal?.estimatedNutrition || { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    kcal: Number(parsedMeal?.estimatedNutrition?.kcal || 0),
    protein: Number(parsedMeal?.estimatedNutrition?.protein || 0),
    fat: Number(parsedMeal?.estimatedNutrition?.fat || 0),
    carbs: Number(parsedMeal?.estimatedNutrition?.carbs || 0),
    amountRatio: Number(parsedMeal?.amountRatio || 1),
    amountNote: parsedMeal?.amountNote || '',
    confidence: parsedMeal?.confidence != null ? Number(parsedMeal.confidence) : null,
    comment: parsedMeal?.comment || '',
    calorie_source: normalizeText(parsedMeal?.calorie_source || 'gemini_estimate'),
    calorie_confidence: normalizeText(parsedMeal?.calorie_confidence || 'medium'),
    original_gemini_calories: Number(parsedMeal?.original_gemini_calories || parsedMeal?.estimatedNutrition?.kcal || 0),
    final_calories: Number(parsedMeal?.final_calories || parsedMeal?.estimatedNutrition?.kcal || 0),
    correction_reason: normalizeText(parsedMeal?.correction_reason || ''),
    sourceLineMessageId: normalizeText(input?.messageId || ''),
    dedupeKey: normalizeText(input?.messageId ? `msg:${input.messageId}` : ''),
    sourceImageHash: normalizeText(input?.messageId || ''),
    raw_model_json: {
      correction: null,
      adoptedNutrition: parsedMeal?.estimatedNutrition || {},
      calorie_source: normalizeText(parsedMeal?.calorie_source || 'gemini_estimate'),
      calorie_confidence: normalizeText(parsedMeal?.calorie_confidence || 'medium'),
      original_gemini_calories: Number(parsedMeal?.original_gemini_calories || parsedMeal?.estimatedNutrition?.kcal || 0),
      final_calories: Number(parsedMeal?.final_calories || parsedMeal?.estimatedNutrition?.kcal || 0),
      correction_reason: normalizeText(parsedMeal?.correction_reason || ''),
      sourceLineMessageId: normalizeText(input?.messageId || ''),
      dedupeKey: normalizeText(input?.messageId ? `msg:${input.messageId}` : ''),
    }
  };
}

function buildBaseMealPayload(parsedMeal, input = {}) {
  const record = buildImageMealRecordPayload(parsedMeal, input);
  return {
    eatenAt: new Date().toISOString(),
    baseMealVersion: 'v1',
    sourceMessageId: normalizeText(input?.messageId || ''),
    sourceImageId: normalizeText(input?.messageId || ''),
    mealLabel: normalizeText(record?.name || '食事'),
    basePayloadJson: {
      items: Array.isArray(record?.items) ? record.items : [],
      estimatedNutrition: record?.estimatedNutrition || {},
      kcal: Number(record?.kcal || 0),
      protein: Number(record?.protein || 0),
      fat: Number(record?.fat || 0),
      carbs: Number(record?.carbs || 0),
      sourceLineMessageId: normalizeText(input?.messageId || ''),
      dedupeKey: normalizeText(input?.messageId ? `msg:${input.messageId}` : ''),
    }
  };
}

function buildLabReply(lab = {}, examDatesForInsert = []) {
  const datesAreUnknown = !Array.isArray(examDatesForInsert) || !examDatesForInsert.length
    || (examDatesForInsert.length === 1 && examDatesForInsert[0] === UNKNOWN_OBSERVED_DATE);
  const fromInsert = (examDatesForInsert || [])
    .filter((x) => normalizeText(x) && normalizeText(x) !== UNKNOWN_OBSERVED_DATE)
    .sort();
  const latestFromInsert = fromInsert.length ? fromInsert[fromInsert.length - 1] : '';
  const examDate = latestFromInsert || normalizeText(lab?.latestExamDate || lab?.examDate || '');
  return [
    '血液検査画像として受け取りました。',
    datesAreUnknown
      ? 'この画像では検査日は明確には読み取れませんでした。'
      : (examDate ? `最新の検査日: ${examDate}` : '検査日は確認中です。'),
    '「TGは？」「患者名は？」「異常がある項目は？」のように聞いてください。'
  ].join('\n');
}

function hasUsableLabMeta(lab = {}) {
  return Boolean(
    normalizeText(lab?.patientName || lab?.meta?.patientName)
    || normalizeText(lab?.facilityName || lab?.meta?.facilityName)
    || normalizeText(lab?.printDate || lab?.meta?.printDate)
  );
}

const UNKNOWN_OBSERVED = UNKNOWN_OBSERVED_DATE;

/** 検査日ラベル用 YYYY-MM-DD（和暦・2桁年・スラッシュ等は classifier に委譲） */
function normalizeExamDateIso(v) {
  const t = normalizeText(v);
  if (!t) return '';
  const via = normalizeLabDateToken(t);
  if (via) return via;
  const s = t.replace(/\//g, '-');
  const m = s.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

function printDateNormalized(lab = {}) {
  return normalizeExamDateIso(lab?.printDate || lab?.meta?.printDate || '');
}

/**
 * 検査日は抽出パイプライン（matrix rows → flatten）に委ねる。
 * ここでは印刷日の混入を防ぎつつ、既存フィールドの正規化のみ行う。
 */
function inferObservedDateForLabItem(it, lab = {}) {
  const pd = printDateNormalized(lab);
  const raw = normalizeText(it?.observedDate || it?.observed_date || it?.date || '');
  if (raw === UNKNOWN_OBSERVED) return UNKNOWN_OBSERVED;
  const iso = normalizeExamDateIso(raw);
  if (iso) {
    if (pd && iso === pd) return UNKNOWN_OBSERVED;
    return iso;
  }
  return UNKNOWN_OBSERVED;
}

function dedupeLabParsedItems(items) {
  if (!Array.isArray(items) || items.length < 2) return items;
  const rank = (s) => {
    const t = String(s || '').toLowerCase();
    if (t === 'gemini_structured' || t === 'gemini_structured_multi_date') return 0;
    if (t.includes('lab_multi') || t.includes('matrix')) return 1;
    if (t === 'row_fallback') return 2;
    return 3;
  };
  const nk = (it) => String(it?.normalizedKey || '').trim().toLowerCase();
  const od = (it) => {
    const raw = String(it?.observedDate || it?.observed_date || UNKNOWN_OBSERVED).trim() || UNKNOWN_OBSERVED;
    if (raw === UNKNOWN_OBSERVED) return UNKNOWN_OBSERVED;
    return normalizeExamDateIso(raw) || UNKNOWN_OBSERVED;
  };
  const val = (it) => String(it?.value ?? '').trim();
  const map = new Map();
  for (const it of items) {
    const key = `${nk(it)}|${od(it)}|${val(it)}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...it });
      continue;
    }
    const keep = rank(it.source) < rank(prev.source) ? it : prev;
    const drop = keep === it ? prev : it;
    let w = { ...keep };
    if (nk(w).startsWith('raw_label:')) {
      const altNk = nk(drop);
      if (altNk && !altNk.startsWith('raw_label:')) w.normalizedKey = drop.normalizedKey;
    }
    map.set(key, w);
  }
  return [...map.values()];
}

async function resolveImagePayload(input) {
  if (input?.webImagePayload?.buffer) {
    return {
      id: normalizeText(input?.messageId || ''),
      buffer: input.webImagePayload.buffer,
      mimeType: input.webImagePayload.mimeType || 'image/jpeg'
    };
  }
  const ingested = await imageIngestService.ingestLineImage(input);
  if (!ingested?.ok || !ingested?.payload?.buffer) return null;
  return ingested.payload;
}

async function handleImageIngest({ input, textHint = '' } = {}) {
  if (input?.messageType !== 'image') return { handled: false, reason: 'not_image' };
  console.info('[phasee-new] new_image_ingress_reached', { userId: input?.userId || '', textHint: normalizeText(textHint).slice(0, 40) });
  phaseeReachabilityService.recordReachability('new_image_ingress_reached', ['services/newflow/image_ingest_orchestrator_service.js'], {
    userId: input?.userId || '',
    textHint: normalizeText(textHint).slice(0, 40)
  }).catch(() => null);
  const imagePayload = await resolveImagePayload(input);
  if (!imagePayload) {
    return {
      handled: true,
      intentType: 'newflow_image_ingest_ng',
      replyText: '画像の取得に失敗しました。もう一度送ってください。'
    };
  }
  const domainDecision = await decideImageDomain({ imagePayload, userId: input.userId, messageId: input.messageId });
  const selectedDomain = domainDecision?.routeKind || 'unknown';

  if (selectedDomain === 'unknown') {
    console.info('[v2-image] route_selected', {
      userId: input.userId,
      routeKind: 'unknown',
      domain: 'unknown',
      gemini_result_present: Boolean(domainDecision?.geminiResultPresent),
      candidate_domain: domainDecision?.candidateDomain || 'unknown',
      confidence: Number(domainDecision?.confidence || 0),
      reject_reason: domainDecision?.rejectReason || 'unknown',
      adopted: Boolean(domainDecision?.adopted)
    });
    return {
      handled: true,
      intentType: 'newflow_image_unknown',
      replyText: '画像を受け取りましたが、食事か血液検査かを判定できませんでした。検査票全体または料理全体が写るように、もう一度画像を送ってください。'
    };
  }
  console.info('[v2-image] route_selected', {
    userId: input.userId,
    routeKind: selectedDomain,
    domain: selectedDomain,
    confidence: Number(domainDecision?.confidence || 0),
    adopted: Boolean(domainDecision?.adopted)
  });

  if (selectedDomain === 'meal') {
    const meal = await mealAnalysisService.analyzeMealImage(imagePayload, input.userId, '').catch(() => null);
    if (!meal || meal?.isMealImage === false) {
      return { handled: true, intentType: 'newflow_meal_image_ng', replyText: '食事画像として判定できませんでした。料理全体が見える画像をもう一度送ってください。' };
    }
    const canonicalSaved = await contextMemoryService.addDailyRecord(input.userId, buildImageMealRecordPayload(meal, input)).catch(() => false);
    if (!canonicalSaved) {
      return {
        handled: true,
        intentType: 'newflow_meal_save_pending',
        replyText: '食事画像の解析はできましたが、保存確認が取れませんでした。もう一度同じ画像を送ってください。'
      };
    }
    const baseMeal = await mealRecalcRepository.createBaseMeal({
      userId: input.userId,
      ...buildBaseMealPayload(meal, input)
    }).catch(() => ({ ok: false }));
    await activeContextStoreService.setActiveContext(input.userId, {
      domain: 'meal_image_session',
      payload: {
        sourceImageId: normalizeText(imagePayload?.id || ''),
        sourceMessageId: normalizeText(input?.messageId || ''),
        baseMealId: Number(baseMeal?.meal?.id || 0) || null,
        meal
      }
    }).catch(() => null);
    const summary = await dailyNutritionSummaryService.fetchTodayNutritionSummary(input.userId);
    const dbTotals = {
      kcal: Number(summary.kcal || 0),
      protein: Number(summary.protein || 0),
      fat: Number(summary.fat || 0),
      carbs: Number(summary.carbs || 0),
      count: Number(summary.meal_count || 0),
    };
    const mk = Number(meal?.estimatedNutrition?.kcal || 0);
    const mp = Number(meal?.estimatedNutrition?.protein || 0);
    const mf = Number(meal?.estimatedNutrition?.fat || 0);
    const mc = Number(meal?.estimatedNutrition?.carbs || 0);
    const todayTotals = {
      kcal: round1(dbTotals.kcal + mk),
      protein: round1(dbTotals.protein + mp),
      fat: round1(dbTotals.fat + mf),
      carbs: round1(dbTotals.carbs + mc),
    };
    const energyBal = await dailyEnergyBalanceService.fetchTodayEnergyBalance(input.userId);
    console.info('[meal_reply_format_start]', {
      user_id: input.userId,
      meal_record_id: '',
      has_calories: Number.isFinite(mk) && mk > 0,
      has_pfc: (Number(mp) > 0 || Number(mf) > 0 || Number(mc) > 0),
    });
    const replyText = mealReplyFormatterService.formatMealReplyText(meal, {
      todayTotals,
      mealCount: dbTotals.count + 1,
      exerciseBurnKcal: Number(energyBal.exerciseBurnKcal || 0),
      netKcal: Number(todayTotals.kcal || 0) - Number(energyBal.exerciseBurnKcal || 0),
    });
    return { handled: true, intentType: 'newflow_meal_image', replyText };
  }

  const ingest = await labDocumentIngestService.ingestLabDocument({ userId: input.userId, imagePayload }).catch(() => null);
  const lab = ingest?.panel || null;
  if (!lab || typeof lab !== 'object') {
    return { handled: true, intentType: 'newflow_lab_image_ng', replyText: '血液検査画像として判定できませんでした。検査票全体が見える画像をもう一度送ってください。' };
  }
  const preDbParsedCandidate = toParsedItemsFromLabPanel(lab);
  const recoveredPrimaryParsed = recoverParsedItemsFromStructuredJson(lab);
  const preDbParsedRaw = preDbParsedCandidate.length ? preDbParsedCandidate : recoveredPrimaryParsed;
  const withObserved = (Array.isArray(preDbParsedRaw) ? preDbParsedRaw : []).map((it) => {
    if (!it || typeof it !== 'object') return it;
    const observedDate = inferObservedDateForLabItem(it, lab);
    return { ...it, observedDate };
  });
  const preDbParsed = dedupeLabParsedItems(withObserved);
  if (preDbParsed.length) {
    lab.itemsStructured = preDbParsed;
  }
  const qualifiedForDb = countPersistableParsedRecords(preDbParsed);
  const labGeminiRaw = lab?.geminiRaw && typeof lab.geminiRaw === 'object' ? { ...lab.geminiRaw } : {};
  if (lab?.metaAdoption || lab?.metaExtraction) {
    labGeminiRaw.lab_meta = {
      metaAdoption: lab.metaAdoption || null,
      metaExtraction: lab.metaExtraction || null,
      metaConfidence: lab.metaConfidence || null
    };
  }
  if (!lab.meta) {
    lab.meta = {
      patientName: String(lab.patientName || ''),
      facilityName: String(lab.facilityName || ''),
      printDate: String(lab.printDate || '')
    };
  }
  console.info('[lab-ingest-trace] stage:parsed_items_pre_insert', {
    userId: input.userId,
    panel_items_structured_len: Array.isArray(lab?.itemsStructured) ? lab.itemsStructured.length : 0,
    panel_items_len: Array.isArray(lab?.items) ? lab.items.length : 0,
    recovered_primary_len: recoveredPrimaryParsed.length,
    parsed_items_len: preDbParsed.length,
    qualified_records: qualifiedForDb
  });
  const observedDatesFromItems = distinctObservedDateStringsFromParsedItems(preDbParsed);
  const examDatesForInsert = examDatesStringArrayForInsert(observedDatesFromItems, qualifiedForDb > 0);
  const examDatesDebugPayload = {
    source: 'parsed_items_distinct_only',
    printDate: printDateNormalized(lab) || normalizeText(lab?.printDate || lab?.meta?.printDate || ''),
    post_assign_distinct_observed: observedDatesFromItems,
    parsed_len: preDbParsed.length,
    distinct_len: observedDatesFromItems.length,
    sample_observed: (preDbParsed[0] && (preDbParsed[0].observedDate || preDbParsed[0].observed_date)) || ''
  };
  console.info('[lab-ingest-trace] stage:exam_dates_from_parsed_items', {
    userId: input.userId,
    exam_dates_json: JSON.stringify(examDatesForInsert),
    observed_dates_distinct: JSON.stringify(observedDatesFromItems),
    exam_dates_debug_json: JSON.stringify(examDatesDebugPayload)
  });
  const insertPayload = {
    userId: input.userId,
    sourceImageId: normalizeText(imagePayload?.id || ''),
    sourceMessageId: normalizeText(input?.messageId || ''),
    status: qualifiedForDb > 0 ? 'active' : 'tentative',
    patientName: lab?.patientName || '',
    facilityName: lab?.facilityName || '',
    printDate: lab?.printDate || '',
    examDates: examDatesForInsert,
    parsedItems: preDbParsed,
    rawText: lab?.rawText || '',
    confidence: Number(lab?.analysisConfidence?.v2_confidence || 0) || 0,
    isLabImageStrict: Boolean(lab?.isLabImage),
    isLabImageTentative: true,
    geminiRaw: Object.keys(labGeminiRaw).length ? labGeminiRaw : (lab?.geminiRaw || null),
    structuredJson: lab?.structuredJson ?? lab?.rawPayload ?? null,
    expiresAt: new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString()
  };
  let preChain = 'pre_persist';
  if (qualifiedForDb === 0) {
    if (Array.isArray(preDbParsed) && preDbParsed.length) {
      preChain = 'parsed_items_present_but_no_qualified_records';
    } else if (Number(lab?.analysisConfidence?.rows || 0) > 0) {
      preChain = 'extraction_had_rows_but_items_empty_downstream';
    } else {
      preChain = 'ingest_items_and_structured_both_empty';
    }
  } else {
    preChain = 'qualified_records_ready';
  }
  const hb = (preDbParsed || []).find((x) => normalizeText(x?.normalizedKey).toLowerCase() === 'hemoglobin');
  if (hb && normalizeText(hb.value)) {
    console.info('[lab-ingest-trace] stage:hemoglobin_persist_path', {
      userId: input.userId,
      normalizedKey: hb.normalizedKey,
      value: hb.value,
      source: hb.source || ''
    });
  }
  labIngestTrace.logRecordsCountReason({
    userId: input.userId,
    stage: 'newflow_image_ingest_pre_db',
    details: {
      recordsCount: qualifiedForDb,
      chain: preChain,
      extractRowCount: Number(lab?.analysisConfidence?.rows || 0),
      buildStructuredItemsCount: preDbParsed.length,
      legacyMapItemsCount: Array.isArray(lab?.items) ? lab.items.length : 0,
      primary_gemini_items: Number(lab?.analysisConfidence?.primary_gemini_items ?? 0),
      row_fallback_used: Boolean(lab?.analysisConfidence?.row_fallback_used),
      parsed_min_items_count: preDbParsed.length
    }
  });
  if (qualifiedForDb > 0 && (!Array.isArray(insertPayload.parsedItems) || insertPayload.parsedItems.length === 0)) {
    console.error('[lab-ingest-trace] stage:parsed_items_guard_blocked_empty_insert', {
      userId: input.userId,
      qualified_records: qualifiedForDb,
      panel_items_structured_len: Array.isArray(lab?.itemsStructured) ? lab.itemsStructured.length : 0,
      recovered_primary_len: recoveredPrimaryParsed.length
    });
    return {
      handled: true,
      intentType: 'newflow_lab_save_pending',
      replyText: '検査画像の解析はできましたが、保存データ整形で不整合を検知しました。もう一度同じ画像を送ってください。'
    };
  }
  const hasMeta = hasUsableLabMeta(lab);
  const shouldPersistSession = qualifiedForDb > 0 || hasMeta;
  if (!shouldPersistSession) {
    console.info('[phasee-new] lab_empty_session_blocked', {
      userId: input.userId,
      blocked: true,
      reason: 'no_qualified_items_and_no_meta',
      qualified_records: qualifiedForDb
    });
    await activeContextStoreService.setActiveContext(input.userId, {
      domain: 'lab_image_session_failed',
      payload: {
        sourceImageId: normalizeText(imagePayload?.id || ''),
        sourceMessageId: normalizeText(input?.messageId || ''),
        reason: 'no_qualified_items_and_no_meta'
      }
    }).catch(() => null);
    return {
      handled: true,
      intentType: 'newflow_lab_extract_insufficient',
      replyText: '血液検査票の数値行をまだ取り込めていません。鮮明に全体が写るよう送り直すか、気になる数値を短く書き添えてください。'
    };
  }

  labIngestTrace.logPreInsert({ userId: input.userId, insertPayload: { source: 'newflow_image_ingest_orchestrator', createLabSessionParams: insertPayload } });
  const persist = await labSessionRepository.createLabSession(insertPayload).catch(() => ({ ok: false, reason: 'insert_exception' }));
  if (persist?.ok && persist?.session?.id) {
    try {
      const labResultItemsWriter = require('./lab_result_items_writer_service');
      await labResultItemsWriter.writeLabResultItemsFromSession({
        userId: input.userId,
        labSessionId: persist.session.id,
        parsedItemsJson: insertPayload.parsedItems || [],
        structuredJson: insertPayload.structuredJson ?? null,
        patientName: insertPayload.patientName,
        facilityName: insertPayload.facilityName,
        printDate: insertPayload.printDate,
        examDatesJson: insertPayload.examDates || []
      });
    } catch (e) {
      console.info('[lab_result_items_writer_error]', {
        lab_session_id: persist.session.id,
        source_json_path: '',
        raw_name: '',
        error_message: String(e?.message || e || 'writer_exception')
      });
    }
  }
  if (!persist?.ok) {
    await activeContextStoreService.setActiveContext(input.userId, {
      domain: 'lab_image_session_failed',
      payload: {
        sourceImageId: normalizeText(imagePayload?.id || ''),
        sourceMessageId: normalizeText(input?.messageId || ''),
        reason: 'db_insert_failed'
      }
    }).catch(() => null);
    return {
      handled: true,
      intentType: 'newflow_lab_save_pending',
      replyText: '検査画像の解析はできましたが、保存確認が取れませんでした。もう一度同じ画像を送ってください。'
    };
  }
  const hasFollowupBody = qualifiedForDb > 0 || hasMeta;
  if (hasFollowupBody) {
    await activeContextStoreService.setActiveContext(input.userId, {
      domain: 'lab_image_session',
      payload: {
        sourceImageId: normalizeText(imagePayload?.id || ''),
        sourceMessageId: normalizeText(input?.messageId || ''),
        labSessionId: persist?.session?.id || null,
        observedDates: examDatesForInsert,
        labPanel: lab
      }
    }).catch(() => null);
  }
  return { handled: true, intentType: 'newflow_lab_image', replyText: buildLabReply(lab, examDatesForInsert) };
}

module.exports = {
  handleImageIngest,
};
