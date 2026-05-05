'use strict';

const labResultItemRepository = require('../../repositories/lab_result_item_repository');
const labItemMasterRepository = require('../../repositories/lab_item_master_repository');
const { normalizeLabItemName } = require('./lab_item_normalizer_service');

function normalizeText(v) {
  return String(v || '').trim();
}

/**
 * normalizeTarget 等の「検出ラベル」→ lab_result_items.normalized_key（DB と同一文字列）
 * マスタ優先、失敗時は明示フォールバック（writer の seed と一致）
 */
const FOLLOWUP_DETECTED_LABEL_TO_DB_KEY = {
  中性脂肪: 'triglycerides_tg',
  TG: 'triglycerides_tg',
  HbA1c: 'hba1c',
  LDL: 'ldl_cholesterol',
  HDL: 'hdl_cholesterol',
  血糖: 'glucose',
  AST: 'ast_got',
  ALT: 'alt_gpt',
  'γ-GTP': 'ggt',
  γGTP: 'ggt',
  LDH: 'ldh',
  クレアチニン: 'creatinine',
  ヘモグロビン: 'hemoglobin',
  総コレステロール: 'total_cholesterol',
  尿酸: 'uric_acid',
  WBC: 'wbc',
  白血球数: 'wbc',
  赤血球数: 'rbc',
  血小板数: 'platelet',
  尿素窒素: 'bun',
  eGFR: 'egfr',
  総蛋白: 'total_protein',
  アルブミン: 'albumin',
  CRP: 'crp',
  CPK: 'cpk'
};

function logReaderDebug(payload) {
  console.info('[lab_result_items_reader_debug]', {
    userId_received: payload.userId_received,
    userId_type: payload.userId_type,
    labSessionId_received: payload.labSessionId_received,
    canonicalKeys: payload.canonicalKeys,
    query_user_id_used: payload.query_user_id_used,
    query_lab_session_id_used: payload.query_lab_session_id_used,
    repositoryError: payload.repositoryError ?? null,
    fetchedRowsCount: payload.fetchedRowsCount,
    fetchedRowUserIdSample: payload.fetchedRowUserIdSample ?? null,
    fetchedRowKeySample: payload.fetchedRowKeySample ?? null,
    userMismatchFallback: payload.userMismatchFallback ?? false,
    matchedByUserFilter: payload.matchedByUserFilter ?? null,
    matchedRowsCount: payload.matchedRowsCount,
    matchedRowSample: payload.matchedRowSample ?? null
  });
}

/**
 * @returns {Promise<{ keys: string[], primaryCanonicalKey: string|null, detectedLabel: string, fromMaster: boolean }>}
 */
async function resolveCanonicalKeysForFollowup(detectedItemLabel) {
  const detectedLabel = normalizeText(detectedItemLabel);
  if (!detectedLabel) {
    return { keys: [], primaryCanonicalKey: null, detectedLabel: '', fromMaster: false };
  }
  const masterRows = await labItemMasterRepository.getAllActiveMasterRows(true);
  const norm = await normalizeLabItemName(detectedLabel, masterRows);
  const keys = [];
  if (norm.from_master && norm.normalized_key && !norm.normalized_key.startsWith('unmapped:')) {
    keys.push(norm.normalized_key);
  }
  const staticKey = FOLLOWUP_DETECTED_LABEL_TO_DB_KEY[detectedLabel];
  if (staticKey && !keys.includes(staticKey)) {
    keys.push(staticKey);
  }
  return {
    keys,
    primaryCanonicalKey: keys.length ? keys[0] : null,
    detectedLabel,
    fromMaster: Boolean(norm.from_master)
  };
}

async function getLatestLabResultByKey({ userId, lineUserId, normalizedKey, labSessionId }) {
  const uid = normalizeText(lineUserId || userId);
  const nk = normalizeText(normalizedKey);
  const sid = Number(labSessionId);
  if (!nk || !Number.isFinite(sid)) return null;
  const pack = await labResultItemRepository.fetchBySessionForFollowup({
    lineUserId: uid,
    labSessionId: sid,
    excludeValidation: ['rejected', 'superseded']
  });
  if (pack.error) return null;
  const hit = pack.rows.filter((r) => normalizeText(r.normalized_key) === nk);
  return hit.length ? hit.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] : null;
}

async function getLabResultsByKey({ userId, lineUserId, normalizedKey, limit = 10 }) {
  return labResultItemRepository.fetchLatestByUserAndKey({
    userId: normalizeText(lineUserId || userId),
    normalizedKey: normalizeText(normalizedKey),
    limit
  });
}

async function getReadableItemsForSession({ userId, lineUserId, labSessionId }) {
  const uid = normalizeText(lineUserId || userId);
  const pack = await labResultItemRepository.fetchBySessionForFollowup({
    lineUserId: uid,
    labSessionId,
    excludeValidation: ['rejected']
  });
  if (pack.error) return [];
  return pack.rows.filter((r) => normalizeText(r.value_text) || r.value_numeric != null);
}

async function getDistinctObservedDates({ userId, lineUserId, labSessionId }) {
  return labResultItemRepository.fetchDistinctObservedDatesForSession({
    userId: normalizeText(lineUserId || userId),
    labSessionId
  });
}

/**
 * @returns {{ replyText: string|null, usedSource: string, row: object|null, canonical_normalized_key: string|null, tried_keys: string[], repositoryError?: string|null }}
 */
async function buildItemFollowupReplyFromResults({
  userId,
  lineUserId,
  labSessionId,
  targetLabel,
  selectedDate
}) {
  const rawUserReceived = lineUserId !== undefined && lineUserId !== null ? lineUserId : userId;
  const lineUid = normalizeText(lineUserId || userId);
  const sid = Number(labSessionId);

  const { keys, primaryCanonicalKey, detectedLabel } = await resolveCanonicalKeysForFollowup(targetLabel);
  if (!keys.length) {
    logReaderDebug({
      userId_received: rawUserReceived,
      userId_type: rawUserReceived === '' || rawUserReceived == null ? 'empty' : typeof rawUserReceived,
      labSessionId_received: labSessionId,
      canonicalKeys: keys,
      query_user_id_used: lineUid,
      query_lab_session_id_used: Number.isFinite(sid) ? sid : null,
      repositoryError: null,
      fetchedRowsCount: 0,
      fetchedRowUserIdSample: null,
      fetchedRowKeySample: null,
      userMismatchFallback: false,
      matchedByUserFilter: null,
      matchedRowsCount: 0,
      matchedRowSample: null
    });
    return {
      replyText: null,
      usedSource: 'no_key_map',
      row: null,
      canonical_normalized_key: null,
      tried_keys: []
    };
  }

  if (!Number.isFinite(sid)) {
    logReaderDebug({
      userId_received: rawUserReceived,
      userId_type: rawUserReceived === '' || rawUserReceived == null ? 'empty' : typeof rawUserReceived,
      labSessionId_received: labSessionId,
      canonicalKeys: keys,
      query_user_id_used: lineUid,
      query_lab_session_id_used: null,
      repositoryError: null,
      fetchedRowsCount: 0,
      fetchedRowUserIdSample: null,
      fetchedRowKeySample: null,
      userMismatchFallback: false,
      matchedByUserFilter: null,
      matchedRowsCount: 0,
      matchedRowSample: null
    });
    return {
      replyText: null,
      usedSource: 'not_found',
      row: null,
      canonical_normalized_key: primaryCanonicalKey,
      tried_keys: keys
    };
  }

  const pack = await labResultItemRepository.fetchBySessionForFollowup({
    lineUserId: lineUid,
    labSessionId: sid,
    excludeValidation: ['rejected', 'superseded']
  });

  if (pack.error) {
    logReaderDebug({
      userId_received: rawUserReceived,
      userId_type: rawUserReceived === '' || rawUserReceived == null ? 'empty' : typeof rawUserReceived,
      labSessionId_received: labSessionId,
      canonicalKeys: keys,
      query_user_id_used: lineUid,
      query_lab_session_id_used: sid,
      repositoryError: pack.error,
      fetchedRowsCount: 0,
      fetchedRowUserIdSample: null,
      fetchedRowKeySample: null,
      userMismatchFallback: false,
      matchedByUserFilter: null,
      matchedRowsCount: 0,
      matchedRowSample: null
    });
    return {
      replyText: null,
      usedSource: 'repository_error',
      row: null,
      canonical_normalized_key: primaryCanonicalKey,
      tried_keys: keys,
      repositoryError: pack.error
    };
  }

  const allRows = pack.rows;

  const pickRowForKey = (nk) => {
    const hit = allRows.filter((r) => normalizeText(r.normalized_key) === normalizeText(nk));
    if (!hit.length) return null;
    const sorted = hit.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    if (!selectedDate) return sorted[0];
    const want = String(selectedDate).slice(0, 10);
    const byDate = sorted.find((r) => r.observed_date && String(r.observed_date).slice(0, 10) === want);
    return byDate || sorted[0];
  };

  let matchedRow = null;
  let matchedKey = null;
  let matchedHitCount = 0;

  for (const nk of keys) {
    const row = pickRowForKey(nk);
    if (!row) continue;
    const hits = allRows.filter((r) => normalizeText(r.normalized_key) === normalizeText(nk));
    matchedHitCount = hits.length;
    if (selectedDate) {
      const want = String(selectedDate).slice(0, 10);
      if (row.observed_date && String(row.observed_date).slice(0, 10) !== want) continue;
    }
    matchedRow = row;
    matchedKey = nk;
    break;
  }

  const matchedRowSample = matchedRow
    ? {
        normalized_key: normalizeText(matchedRow.normalized_key),
        validation_status: normalizeText(matchedRow.validation_status),
        value_text: matchedRow.value_text != null ? String(matchedRow.value_text).slice(0, 48) : null,
        value_numeric: matchedRow.value_numeric
      }
    : null;

  logReaderDebug({
    userId_received: rawUserReceived,
    userId_type: rawUserReceived === '' || rawUserReceived == null ? 'empty' : typeof rawUserReceived,
    labSessionId_received: labSessionId,
    canonicalKeys: keys,
    query_user_id_used: lineUid,
    query_lab_session_id_used: sid,
    repositoryError: null,
    fetchedRowsCount: pack.sessionRowCount,
    fetchedRowUserIdSample: pack.sessionUserIdSample.length ? pack.sessionUserIdSample : null,
    fetchedRowKeySample: pack.sessionKeySample.length ? pack.sessionKeySample : null,
    userMismatchFallback: Boolean(pack.userMismatch),
    matchedByUserFilter: pack.matchedByUserFilter,
    matchedRowsCount: matchedRow ? matchedHitCount : 0,
    matchedRowSample
  });

  if (!matchedRow) {
    return {
      replyText: null,
      usedSource: 'not_found',
      row: null,
      canonical_normalized_key: primaryCanonicalKey,
      tried_keys: keys
    };
  }

  const u = normalizeText(matchedRow.unit);
  const val = matchedRow.value_text != null ? String(matchedRow.value_text) : String(matchedRow.value_numeric ?? '');
  const name = normalizeText(matchedRow.display_name) || detectedLabel;
  if (!val) {
    return {
      replyText: null,
      usedSource: 'empty_value',
      row: matchedRow,
      canonical_normalized_key: matchedKey,
      tried_keys: keys
    };
  }
  if (matchedRow.validation_status === 'needs_manual_review') {
    return {
      replyText: `${name}として ${val}${u ? ` ${u}` : ''} が読み取られていますが、データ上の確認が必要です。原本の確認をおすすめします。`,
      usedSource: 'lab_result_items',
      row: matchedRow,
      canonical_normalized_key: matchedKey,
      tried_keys: keys
    };
  }
  return {
    replyText: `${name}は ${val}${u ? ` ${u}` : ''} と読み取れています。`,
    usedSource: 'lab_result_items',
    row: matchedRow,
    canonical_normalized_key: matchedKey,
    tried_keys: keys
  };
}

function logResultItemsSource(payload) {
  console.info('[lab_followup_result_items_source]', {
    question: payload.question,
    detected_item_label: payload.detected_item_label,
    canonical_normalized_key: payload.canonical_normalized_key,
    selected_lab_session_id: payload.selected_lab_session_id,
    answer_source_session_id: payload.answer_source_session_id,
    used_source: payload.used_source,
    result_count: payload.result_count,
    fallback_reason: payload.fallback_reason
  });
}

/** 正本行から「何読み取れた」用の箇条書き */
async function buildInventorySummaryFromSession({ userId, lineUserId, labSessionId }) {
  const rows = await getReadableItemsForSession({ userId, lineUserId, labSessionId });
  if (!rows.length) return null;
  const lines = rows
    .map((r) => {
      const v = r.value_text != null ? String(r.value_text) : (r.value_numeric != null ? String(r.value_numeric) : '');
      if (!v) return '';
      const u = normalizeText(r.unit);
      return `・${normalizeText(r.display_name) || r.normalized_key}: ${v}${u ? ` ${u}` : ''}`;
    })
    .filter(Boolean);
  if (!lines.length) return null;
  return ['正本DBに取り込まれた候補は次のとおりです。', ...lines.slice(0, 30)].join('\n');
}

module.exports = {
  getLatestLabResultByKey,
  getLabResultsByKey,
  getReadableItemsForSession,
  getDistinctObservedDates,
  buildItemFollowupReplyFromResults,
  buildInventorySummaryFromSession,
  resolveCanonicalKeysForFollowup,
  logResultItemsSource,
  logReaderDebug
};
