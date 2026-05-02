'use strict';

const { decideImageDomain } = require('./image_domain_router_service');
const activeContextStoreService = require('./active_context_store_service');
const imageIngestService = require('../image_ingest_service');
const mealAnalysisService = require('../meal_analysis_service');
const labDocumentIngestService = require('../lab_document_ingest_service');
const labSessionRepository = require('../../repositories/lab_session_repository');
const mealRecalcRepository = require('../../repositories/meal_recalc_repository');
const contextMemoryService = require('../context_memory_service');
const phaseeReachabilityService = require('../phasee_reachability_service');
const labIngestTrace = require('../lab_ingest_trace_service');
const { countPersistableParsedRecords, extractPrimaryGeminiMinItems } = require('../lab_gemini_items_service');

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

function buildMealReply(meal) {
  const items = Array.isArray(meal?.items) ? meal.items.filter(Boolean).join('、') : '';
  const kcal = round1(meal?.estimatedNutrition?.kcal || 0);
  const protein = round1(meal?.estimatedNutrition?.protein || 0);
  const fat = round1(meal?.estimatedNutrition?.fat || 0);
  const carbs = round1(meal?.estimatedNutrition?.carbs || 0);
  return [
    '🍽️ 食事画像として受け取りました。',
    `見立て: ${items || '品目未特定'}`,
    `目安: ${kcal} kcal / P ${protein}g / F ${fat}g / C ${carbs}g`,
    '✨ 必要なら「麺だけ0kcal」「半分食べた」のように続けて補正できます。'
  ].join('\n');
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
    sourceLineMessageId: normalizeText(input?.messageId || ''),
    dedupeKey: normalizeText(input?.messageId ? `msg:${input.messageId}` : ''),
    sourceImageHash: normalizeText(input?.messageId || ''),
    raw_model_json: {
      correction: null,
      adoptedNutrition: parsedMeal?.estimatedNutrition || {},
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

function buildLabReply(lab = {}) {
  const examDate = normalizeText(lab?.latestExamDate || lab?.examDate || '');
  return [
    '血液検査画像として受け取りました。',
    examDate ? `最新の検査日: ${examDate}` : '検査日は確認中です。',
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

function normalizeYmd(v) {
  const s = normalizeText(v).replace(/\//g, '-');
  const m = s.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

const UNKNOWN_OBSERVED = 'unknown_date';

function printDateNormalized(lab = {}) {
  return normalizeYmd(lab?.printDate || lab?.meta?.printDate || '');
}

function inferObservedDateForLabItem(it, lab = {}) {
  const direct = normalizeYmd(it?.observedDate || it?.observed_date || '');
  if (direct) return direct;
  const pd = printDateNormalized(lab);
  const fromExams = [];
  if (Array.isArray(lab?.examDates)) {
    for (const d of lab.examDates) {
      const x = normalizeYmd(d);
      if (x && (!pd || x !== pd)) fromExams.push(x);
    }
  }
  if (Array.isArray(lab?.examDateEntries)) {
    for (const e of lab.examDateEntries) {
      const x = normalizeYmd(e?.normalized_date || e?.normalizedDate || e?.value || '');
      if (x && (!pd || x !== pd)) fromExams.push(x);
    }
  }
  const latest = normalizeYmd(lab?.latestExamDate || lab?.examDate || '');
  if (latest && (!pd || latest !== pd)) return latest;
  const uniq = Array.from(new Set(fromExams)).sort();
  if (uniq.length === 1) return uniq[0];
  if (uniq.length > 1) return uniq[uniq.length - 1];
  return UNKNOWN_OBSERVED;
}

function dedupeLabParsedItems(items) {
  if (!Array.isArray(items) || items.length < 2) return items;
  const rank = (s) => {
    const t = String(s || '').toLowerCase();
    if (t === 'gemini_structured') return 0;
    if (t.includes('lab_multi') || t.includes('matrix')) return 1;
    if (t === 'row_fallback') return 2;
    return 3;
  };
  const nk = (it) => String(it?.normalizedKey || '').trim().toLowerCase();
  const od = (it) => String(it?.observedDate || it?.observed_date || UNKNOWN_OBSERVED).trim() || UNKNOWN_OBSERVED;
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

function distinctObservedDatesFromParsed(items) {
  const set = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    const d = normalizeText(it?.observedDate || it?.observed_date || '');
    if (!d) continue;
    if (d === UNKNOWN_OBSERVED) set.add(UNKNOWN_OBSERVED);
    else {
      const y = normalizeYmd(d);
      if (y) set.add(y);
    }
  }
  return [...set].sort((a, b) => String(a).localeCompare(String(b)));
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
    return { handled: true, intentType: 'newflow_meal_image', replyText: buildMealReply(meal) };
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
  const observedDatesFromItems = distinctObservedDatesFromParsed(preDbParsed);
  const examDatesForInsert = observedDatesFromItems.length
    ? observedDatesFromItems
    : [];
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
        observedDates: observedDatesFromItems,
        labPanel: lab
      }
    }).catch(() => null);
  }
  return { handled: true, intentType: 'newflow_lab_image', replyText: buildLabReply(lab) };
}

module.exports = {
  handleImageIngest,
};
