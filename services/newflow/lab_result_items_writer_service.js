'use strict';

const crypto = require('crypto');
const labItemMasterRepository = require('../../repositories/lab_item_master_repository');
const labResultItemRepository = require('../../repositories/lab_result_item_repository');
const { mergeExtractorOutputs } = require('./lab_result_candidate_extractor_service');
const { normalizeLabItemName } = require('./lab_item_normalizer_service');
const { parseLabValueFields } = require('./lab_result_value_parser_service');
const { resolveObservedDate, extractYmd } = require('./lab_result_date_resolver_service');
const { applyValidationRules } = require('./lab_result_validation_service');
const { dedupeLabResultRows } = require('./lab_result_dedupe_service');

function normalizeText(v) {
  return String(v || '').trim();
}

function itemHash(parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

async function writeLabResultItemsFromSession(params = {}) {
  const userId = normalizeText(params.userId);
  const labSessionId = Number(params.labSessionId);
  const parsedItemsJson = params.parsedItemsJson;
  const structuredJson = params.structuredJson;
  const patientName = normalizeText(params.patientName || '');
  const facilityName = normalizeText(params.facilityName || '');
  const printDate = params.printDate || '';
  const examDatesJson = Array.isArray(params.examDatesJson) ? params.examDatesJson : [];

  console.info('[lab_result_items_writer_start]', {
    user_id: userId,
    lab_session_id: labSessionId,
    has_parsed_items_json: Array.isArray(parsedItemsJson) && parsedItemsJson.length > 0,
    has_structured_json: structuredJson != null && typeof structuredJson === 'object'
  });

  if (!userId || !Number.isFinite(labSessionId)) {
    console.info('[lab_result_items_writer_error]', { lab_session_id: labSessionId, raw_name: '', error_message: 'missing user or session' });
    return { ok: false, reason: 'missing_params' };
  }

  const structuredRoot =
    structuredJson && typeof structuredJson === 'object'
      ? structuredJson
      : parsedItemsJson?.length
        ? { items: parsedItemsJson }
        : {};

  const candidates = mergeExtractorOutputs(structuredRoot, parsedItemsJson || []);
  console.info('[lab_result_candidate_extract_summary]', {
    lab_session_id: labSessionId,
    candidate_count: candidates.length,
    candidate_shape_examples: candidates.slice(0, 5).map((c) => ({
      rawName: c.rawName,
      path: c.sourceJsonPath,
      valueText: (c.valueText || '').slice(0, 24)
    }))
  });

  const masterRows = await labItemMasterRepository.getAllActiveMasterRows(true);
  const examYmDs = examDatesJson.map((x) => String(x)).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  const multiDatePanel = examYmDs.length > 1 || candidates.some((c) => normalizeText(c.observedDateText).length > 8);

  const normalizedRows = [];
  for (const c of candidates) {
    try {
      const norm = await normalizeLabItemName(c.rawName, masterRows);
      const parsed = parseLabValueFields(c);
      const ymdFromCand = extractYmd(c.observedDateText || '');
      const dateCtx = resolveObservedDate({
        printDate,
        examDatesJson,
        observedDateText: c.observedDateText,
        multiDatePanel
      });

      let observed_date = ymdFromCand || dateCtx.observed_date;

      const row = {
        user_id: userId,
        lab_session_id: labSessionId,
        patient_name: patientName || null,
        facility_name: facilityName || null,
        observed_date,
        observed_date_text: dateCtx.observed_date_text || null,
        observed_date_status: dateCtx.observed_date_status || 'unknown',
        normalized_key: norm.normalized_key,
        display_name: norm.display_name,
        raw_name: c.rawName,
        value_text: parsed.valueText,
        value_numeric: parsed.valueNumeric != null ? parsed.valueNumeric : null,
        unit: parsed.unit || null,
        reference_range: parsed.referenceRange || null,
        flag: null,
        source: 'gemini',
        source_json_path: c.sourceJsonPath || null,
        source_item_hash: itemHash([
          norm.normalized_key,
          observed_date || '',
          normalizeText(parsed.valueText || ''),
          c.sourceJsonPath || ''
        ]),
        raw_item_json: c.rawItemJson || {},
        confidence: null,
        validation_status: 'ok',
        review_reason: dateCtx.review_reason || parsed.parseNote || null,
        from_master: norm.from_master,
        date_review_reason: dateCtx.review_reason
      };

      if (!norm.from_master) {
        row.validation_status = 'needs_manual_review';
        row.review_reason = 'unmapped_lab_item';
      }
      if (parsed.parseNote === 'value_field_looks_like_reference_range') {
        row.validation_status = 'needs_manual_review';
        row.review_reason = 'value_looks_like_reference_range';
      }

      const validated = applyValidationRules(row);
      normalizedRows.push(validated);
    } catch (e) {
      console.info('[lab_result_items_writer_error]', {
        lab_session_id: labSessionId,
        source_json_path: c.sourceJsonPath,
        raw_name: c.rawName,
        error_message: normalizeText(e?.message || 'row_error')
      });
    }
  }

  const { rows: deduped, stats: dedupeStats } = dedupeLabResultRows(normalizedRows);
  console.info('[lab_result_items_dedup_summary]', {
    lab_session_id: labSessionId,
    ...dedupeStats
  });

  await labResultItemRepository.deleteByLabSessionId(labSessionId).catch(() => null);

  let inserted_count = 0;
  let failed_count = 0;
  let needs_manual_review_count = 0;
  const validationBuckets = { ok: 0, needs_manual_review: 0, rejected: 0 };
  const reviewReasons = {};

  for (const r of deduped) {
    const insertPayload = {
      user_id: r.user_id,
      lab_session_id: r.lab_session_id,
      patient_name: r.patient_name,
      facility_name: r.facility_name,
      observed_date: r.observed_date || null,
      observed_date_text: r.observed_date_text,
      observed_date_status: r.observed_date_status || 'unknown',
      normalized_key: r.normalized_key,
      display_name: r.display_name,
      raw_name: r.raw_name,
      value_text: r.value_text,
      value_numeric: r.value_numeric,
      unit: r.unit,
      reference_range: r.reference_range,
      flag: r.flag,
      source: r.source || 'gemini',
      source_json_path: r.source_json_path,
      source_item_hash: r.source_item_hash,
      raw_item_json: r.raw_item_json,
      confidence: r.confidence,
      validation_status: r.validation_status || 'ok',
      review_reason: r.review_reason,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const vs = normalizeText(insertPayload.validation_status) || 'ok';
    validationBuckets[vs] = (validationBuckets[vs] || 0) + 1;
    if (vs === 'needs_manual_review') {
      needs_manual_review_count += 1;
      const rr = normalizeText(insertPayload.review_reason) || 'unknown';
      reviewReasons[rr] = (reviewReasons[rr] || 0) + 1;
    }

    const ins = await labResultItemRepository.insertRow(insertPayload);
    if (ins.ok) inserted_count += 1;
    else {
      failed_count += 1;
      console.info('[lab_result_items_writer_error]', {
        lab_session_id: labSessionId,
        source_json_path: insertPayload.source_json_path,
        raw_name: insertPayload.raw_name,
        error_message: ins.reason || 'insert_failed'
      });
    }
  }

  console.info('[lab_result_items_upsert_summary]', {
    lab_session_id: labSessionId,
    user_id: userId,
    candidate_count: candidates.length,
    normalized_count: normalizedRows.length,
    unmapped_count: normalizedRows.filter((x) => normalizeText(x.normalized_key).startsWith('unmapped:')).length,
    inserted_count,
    updated_count: 0,
    skipped_count: dedupeStats.skipped_duplicate_count,
    failed_count,
    needs_manual_review_count
  });

  console.info('[lab_result_items_validation_summary]', {
    lab_session_id: labSessionId,
    ok_count: validationBuckets.ok || 0,
    needs_manual_review_count,
    rejected_count: validationBuckets.rejected || 0,
    review_reasons: reviewReasons
  });

  return {
    ok: failed_count === 0,
    inserted_count,
    failed_count,
    dedupeStats
  };
}

async function backfillLabResultItemsForSession({ labSessionId }) {
  let supabase = null;
  try {
    ({ supabase } = require('../supabase_service'));
  } catch (_e) {
    supabase = null;
  }
  if (!supabase || labSessionId == null) return { ok: false, reason: 'missing' };
  const sid = Number(labSessionId);
  const q = await supabase
    .from('lab_sessions')
    .select('id,user_id,patient_name,facility_name,print_date,exam_dates_json,parsed_items_json,gemini_raw,structured_json')
    .eq('id', sid)
    .maybeSingle();
  if (q?.error || !q?.data) return { ok: false, reason: 'session_not_found' };
  const row = q.data;
  const structuredJson = row.structured_json || (row.gemini_raw && typeof row.gemini_raw === 'object' ? row.gemini_raw : null);
  const res = await writeLabResultItemsFromSession({
    userId: row.user_id,
    labSessionId: row.id,
    parsedItemsJson: Array.isArray(row.parsed_items_json) ? row.parsed_items_json : [],
    structuredJson,
    patientName: row.patient_name,
    facilityName: row.facility_name,
    printDate: row.print_date,
    examDatesJson: Array.isArray(row.exam_dates_json) ? row.exam_dates_json : []
  });
  console.info('[lab_result_items_backfill_summary]', {
    target: `session:${sid}`,
    processed_sessions: 1,
    success_count: res.ok ? 1 : 0,
    failed_count: res.ok ? 0 : 1
  });
  return res;
}

async function backfillLabResultItemsForUser({ userId, limit = 20 }) {
  let supabase = null;
  try {
    ({ supabase } = require('../supabase_service'));
  } catch (_e) {
    supabase = null;
  }
  const uid = normalizeText(userId);
  if (!supabase || !uid) return { ok: false, reason: 'missing' };
  const q = await supabase
    .from('lab_sessions')
    .select('id')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  const ids = Array.isArray(q.data) ? q.data.map((r) => r.id) : [];
  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    const r = await backfillLabResultItemsForSession({ labSessionId: id });
    if (r?.ok !== false && (r?.failed_count === 0 || r?.inserted_count > 0)) ok += 1;
    else fail += 1;
  }
  console.info('[lab_result_items_backfill_summary]', {
    target: `user:${uid}`,
    processed_sessions: ids.length,
    success_count: ok,
    failed_count: fail
  });
  return { ok: true, processed: ids.length, success_count: ok, failed_count: fail };
}

module.exports = {
  writeLabResultItemsFromSession,
  backfillLabResultItemsForSession,
  backfillLabResultItemsForUser
};
