'use strict';

const MAX_STRING = Number(process.env.LAB_INGEST_TRACE_MAX_CHARS || 500000);

function safeStringify(value) {
  try {
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 0);
  } catch (e) {
    return String(e?.message || e);
  }
}

function clipFull(text) {
  const s = typeof text === 'string' ? text : safeStringify(text);
  if (s.length <= MAX_STRING) return s;
  return `${s.slice(0, MAX_STRING)}\n... [lab-ingest-trace truncated total_len=${s.length}]`;
}

/**
 * Gemini 構造化レスポンス（raw）と parse 直後の structured_json
 */
function logGeminiAndStructured({ userId, source, note, geminiRaw, structuredJsonParsed }) {
  const gRaw = geminiRaw != null ? clipFull(geminiRaw) : 'null';
  const sJson = structuredJsonParsed != null ? clipFull(structuredJsonParsed) : 'null';
  console.info('[lab-ingest-trace] stage:gemini_structured', {
    userId: String(userId || ''),
    source: String(source || 'unknown'),
    note: String(note || ''),
    gemini_raw: gRaw,
    structured_json: sJson
  });
}

/**
 * v2 パネル直後
 */
function logLabPanelCreated({ userId, source, stage, panel }) {
  const p = panel || {};
  const parsed = Array.isArray(p.itemsStructured) ? p.itemsStructured : [];
  const legacy = Array.isArray(p.items) ? p.items : [];
  console.info('[lab-ingest-trace] stage:lab_panel_built', {
    userId: String(userId || ''),
    source: String(source || 'v2'),
    stage: String(stage || 'analyzeLabImageV2'),
    items_length: legacy.length,
    items_structured_length: parsed.length,
    analysis_rows: Number(p?.analysisConfidence?.rows ?? 0),
    patient_name: String(p.patientName || p.patient_name || ''),
    facility_name: String(p.facilityName || p.facility_name || ''),
    print_date: String(p.printDate || p.print_date || ''),
    parsed_items_json: clipFull(parsed)
  });
}

/**
 * パイプライン: items が 0 になる地点の説明
 */
function logRecordsCountReason({ userId, stage, details }) {
  console.info('[lab-ingest-trace] stage:items_pipeline', {
    userId: String(userId || ''),
    stage: String(stage || '?'),
    records_count: Number(details?.recordsCount ?? 0),
    chain: String(details?.chain || ''),
    extract_row_count: Number(details?.extractRowCount ?? 0),
    build_structured_items_count: Number(details?.buildStructuredItemsCount ?? 0),
    legacy_map_items_count: Number(details?.legacyMapItemsCount ?? 0),
    primary_gemini_items: Number(details?.primary_gemini_items ?? details?.primaryGeminiItems ?? 0),
    row_fallback_used: Boolean(details?.row_fallback_used ?? details?.rowFallbackUsed),
    parsed_min_items_count: Number(details?.parsed_min_items_count ?? 0)
  });
}

/**
 * DB 挿入直前
 */
function logPreInsert({ userId, insertPayload }) {
  let out = insertPayload;
  if (out && typeof out === 'object') {
    out = { ...out };
    if (out.createLabSessionParams) {
      out.createLabSessionParams = { ...out.createLabSessionParams };
      if (out.createLabSessionParams.geminiRaw != null) {
        out.createLabSessionParams.geminiRaw = clipFull(out.createLabSessionParams.geminiRaw);
      }
      if (out.createLabSessionParams.structuredJson != null) {
        out.createLabSessionParams.structuredJson = clipFull(out.createLabSessionParams.structuredJson);
      }
    }
    if (out.supabaseInsertRow) {
      out.supabaseInsertRow = { ...out.supabaseInsertRow };
      if (out.supabaseInsertRow.gemini_raw != null) {
        out.supabaseInsertRow.gemini_raw = clipFull(out.supabaseInsertRow.gemini_raw);
      }
      if (out.supabaseInsertRow.structured_json != null) {
        out.supabaseInsertRow.structured_json = clipFull(out.supabaseInsertRow.structured_json);
      }
      if (out.supabaseInsertRow.parsed_items_json != null) {
        out.supabaseInsertRow.parsed_items_json = clipFull(out.supabaseInsertRow.parsed_items_json);
      }
      if (Array.isArray(out.supabaseInsertRow.exam_dates_json)) {
        out.supabaseInsertRow.exam_dates_json = JSON.stringify(out.supabaseInsertRow.exam_dates_json);
      }
    }
  }
  console.info('[lab-ingest-trace] stage:db_pre_insert', {
    userId: String(userId || ''),
    insert_payload: out
  });
}

/**
 * insert 成否と読み戻し
 */
function logPostInsertReadback({ userId, sessionId, readRow, readError, insertError }) {
  let rowLog = readRow;
  const exDebug = readRow && Array.isArray(readRow.exam_dates_json) ? readRow.exam_dates_json : [];
  if (rowLog && typeof rowLog === 'object') {
    rowLog = { ...rowLog };
    if (rowLog.gemini_raw != null) rowLog.gemini_raw = clipFull(rowLog.gemini_raw);
    if (rowLog.structured_json != null) rowLog.structured_json = clipFull(rowLog.structured_json);
    if (rowLog.parsed_items_json != null) rowLog.parsed_items_json = clipFull(rowLog.parsed_items_json);
    if (Array.isArray(rowLog.exam_dates_json)) {
      rowLog.exam_dates_json = JSON.stringify(rowLog.exam_dates_json);
    }
  }
  console.info('[lab-ingest-trace] stage:exam_dates_debug_json', {
    userId: String(userId || ''),
    session_id: String(sessionId || ''),
    exam_dates_debug_json: JSON.stringify(exDebug)
  });
  console.info('[lab-ingest-trace] stage:db_post_insert_read', {
    userId: String(userId || ''),
    session_id: String(sessionId || ''),
    read_error: readError ? String(readError?.message || readError) : null,
    insert_error: insertError ? String(insertError) : null,
    lab_session_row: rowLog
  });
}

module.exports = {
  logGeminiAndStructured,
  logLabPanelCreated,
  logRecordsCountReason,
  logPreInsert,
  logPostInsertReadback,
  clipFull,
  safeStringify
};
