'use strict';

const labResultItemRepository = require('../../repositories/lab_result_item_repository');
const labItemMasterRepository = require('../../repositories/lab_item_master_repository');
const { normalizeLabItemName } = require('./lab_item_normalizer_service');

function normalizeText(v) {
  return String(v || '').trim();
}

/**
 * normalizeTarget 等の「検出ラベル」→ lab_result_items.normalized_key（DB と同一文字列）
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

/** 照合用: NFKC + 小文字 + 空白潰し（全角半角・記号のゆらぎを吸収） */
function normalizeForLabMatch(s) {
  let t = normalizeText(s);
  try {
    t = t.normalize('NFKC');
  } catch (_e) {
    /* ignore */
  }
  return t
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[・･]/g, '');
}

function buildRowHaystack(row) {
  const disp = normalizeText(row.display_name);
  const raw = normalizeText(row.raw_name);
  const nk = normalizeText(row.normalized_key);
  return normalizeForLabMatch(`${disp} ${raw} ${nk}`);
}

/**
 * targetLabel（normalizeTarget 結果）→ label fallback 用の部分文字列（normalizeForLabMatch 済みで比較）
 */
const LABEL_FALLBACK_TERMS_BY_TARGET = {
  中性脂肪: [
    '中性脂肪',
    'tg',
    'triglyceride',
    'triglycerides',
    'トリグリ',
    'トリグリセリド',
    'triglycerides_tg'
  ],
  TG: [
    '中性脂肪',
    'tg',
    'triglyceride',
    'triglycerides',
    'トリグリ',
    'トリグリセリド',
    'triglycerides_tg'
  ],
  HbA1c: ['hba1c', 'a1c', '糖化ヘモグロビン', '糖化', 'hb1ac', 'hba1c(ngsp)'],
  LDH: ['ldh', '乳酸脱水素酵素'],
  AST: ['ast', 'got'],
  ALT: ['alt', 'gpt'],
  血糖: ['血糖', 'glucose', 'glu', '血糖値'],
  クレアチニン: ['クレアチニン', 'creatinine', 'cre', 'cr'],
  ヘモグロビン: ['ヘモグロビン', '血色素', 'hgb', 'hb', 'hemoglobin']
};

function getLabelFallbackTerms(targetLabel) {
  const tl = normalizeText(targetLabel);
  if (LABEL_FALLBACK_TERMS_BY_TARGET[tl]) {
    return LABEL_FALLBACK_TERMS_BY_TARGET[tl].map((x) => normalizeForLabMatch(x));
  }
  const k = normalizeForLabMatch(tl);
  return k ? [k] : [];
}

function rowHasUsableValue(row) {
  return Boolean(normalizeText(row.value_text) || row.value_numeric != null);
}

/** A1c 単独で HbA1c とみなす（HGB などと誤爆しにくいよう hba1c / 糖化 / a1c 境界） */
function hayMatchesHbA1cTerms(hay) {
  if (hay.includes(normalizeForLabMatch('hba1c'))) return true;
  if (hay.includes(normalizeForLabMatch('糖化ヘモグロビン')) || hay.includes(normalizeForLabMatch('糖化'))) return true;
  const m = /(?:^|[^a-z0-9])a1c(?:[^a-z0-9]|$)/i.exec(hay);
  return Boolean(m);
}

function hayMatchesTerms(hay, targetLabel, normalizedTerms) {
  const tl = normalizeText(targetLabel);
  if (tl === 'HbA1c') {
    if (hayMatchesHbA1cTerms(hay)) return true;
  }
  for (const term of normalizedTerms) {
    if (!term) continue;
    if (hay.includes(term)) return true;
  }
  if (tl === 'TG' || tl === '中性脂肪') {
    if (/(?:^|[^a-z])tg(?:[^a-z]|$)/i.test(hay)) return true;
  }
  if (tl === 'LDH') {
    if (/(?:^|[^a-z])ldh(?:[^a-z]|$)/i.test(hay)) return true;
  }
  return false;
}

function filterLabelFallbackHits(allRows, targetLabel) {
  const terms = getLabelFallbackTerms(targetLabel);
  if (!terms.length) return { hits: [], terms };
  const hits = [];
  for (const r of allRows) {
    if (!rowHasUsableValue(r)) continue;
    const hay = buildRowHaystack(r);
    if (hayMatchesTerms(hay, targetLabel, terms)) hits.push(r);
  }
  return { hits, terms };
}

function pickBestAmongLabelHits(hits, selectedDate) {
  if (!hits.length) return null;
  const want = selectedDate ? String(selectedDate).slice(0, 10) : '';
  const scored = hits.map((r) => {
    const hasVal = rowHasUsableValue(r) ? 1 : 0;
    const dateMatch =
      want && r.observed_date && String(r.observed_date).slice(0, 10) === want ? 1 : 0;
    const vs = normalizeText(r.validation_status);
    const okPref = vs === 'ok' ? 2 : vs === 'needs_manual_review' ? 1 : 0;
    const obs = r.observed_date ? String(r.observed_date).slice(0, 10) : '';
    const upd = String(r.updated_at || '');
    const crt = String(r.created_at || '');
    return { r, hasVal, dateMatch, okPref, obs, upd, crt };
  });
  scored.sort((a, b) => {
    if (b.hasVal !== a.hasVal) return b.hasVal - a.hasVal;
    if (b.dateMatch !== a.dateMatch) return b.dateMatch - a.dateMatch;
    if (b.okPref !== a.okPref) return b.okPref - a.okPref;
    if (b.obs !== a.obs) return b.obs.localeCompare(a.obs);
    if (b.upd !== a.upd) return b.upd.localeCompare(a.upd);
    return b.crt.localeCompare(a.crt);
  });
  return scored[0].r;
}

function countCanonicalMatches(allRows, keys) {
  let n = 0;
  for (const r of allRows) {
    const rnk = normalizeText(r.normalized_key).toLowerCase();
    if (keys.some((k) => normalizeText(k).toLowerCase() === rnk)) n += 1;
  }
  return n;
}

function uniqueFetchedKeysSample(allRows, limit = 50) {
  const set = new Set();
  for (const r of allRows) {
    const k = normalizeText(r.normalized_key);
    if (k) set.add(k);
  }
  return [...set].sort().slice(0, limit);
}

function uniqueFetchedNamesSample(allRows, limit = 40) {
  const set = new Set();
  for (const r of allRows) {
    const s = normalizeText(r.display_name) || normalizeText(r.raw_name);
    if (s) set.add(s.slice(0, 80));
  }
  return [...set].sort().slice(0, limit);
}

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
    matchedRowSample: payload.matchedRowSample ?? null,
    canonical_match_attempted: payload.canonical_match_attempted ?? false,
    canonical_match_count: payload.canonical_match_count ?? 0,
    label_fallback_attempted: payload.label_fallback_attempted ?? false,
    label_fallback_used: payload.label_fallback_used ?? false,
    labelFallbackTargetTerms: payload.labelFallbackTargetTerms ?? [],
    labelFallbackMatchedCount: payload.labelFallbackMatchedCount ?? 0,
    labelFallbackMatchedSample: payload.labelFallbackMatchedSample ?? null,
    uniqueFetchedKeys: payload.uniqueFetchedKeys ?? [],
    uniqueFetchedNamesSample: payload.uniqueFetchedNamesSample ?? [],
    finalUsedSource: payload.finalUsedSource ?? null,
    finalResultCount: payload.finalResultCount ?? 0,
    labelHaystackSample: payload.labelHaystackSample ?? null
  });
}

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
  const nkl = nk.toLowerCase();
  const hit = pack.rows.filter((r) => normalizeText(r.normalized_key).toLowerCase() === nkl);
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

function pickRowForCanonicalKey(allRows, nk, selectedDate) {
  const nkl = normalizeText(nk).toLowerCase();
  const hit = allRows.filter((r) => normalizeText(r.normalized_key).toLowerCase() === nkl);
  if (!hit.length) return null;
  const sorted = hit.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  if (!selectedDate) return sorted[0];
  const want = String(selectedDate).slice(0, 10);
  const byDate = sorted.filter((r) => r.observed_date && String(r.observed_date).slice(0, 10) === want);
  if (byDate.length) {
    byDate.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    return byDate[0];
  }
  return sorted[0];
}

function isLdhLikeRow(row, targetLabel) {
  if (normalizeText(targetLabel) !== 'LDH') return false;
  const hay = buildRowHaystack(row);
  return hayMatchesTerms(hay, 'LDH', getLabelFallbackTerms('LDH'));
}

function buildReplyForRow(matchedRow, detectedLabel, replySource, primaryIntentKey) {
  const u = normalizeText(matchedRow.unit);
  const val = matchedRow.value_text != null ? String(matchedRow.value_text) : String(matchedRow.value_numeric ?? '');
  const name = normalizeText(matchedRow.display_name) || detectedLabel;
  const intentKey = normalizeText(primaryIntentKey || '').toLowerCase();

  if (!val) {
    return {
      replyText: null,
      usedSource: 'empty_value',
      canonical_normalized_key: primaryIntentKey,
      row: matchedRow
    };
  }

  if (matchedRow.validation_status === 'needs_manual_review') {
    if (intentKey === 'ldh' || isLdhLikeRow(matchedRow, 'LDH')) {
      return {
        replyText: `${name}は ${val}${u ? ` ${u}` : ''} と読み取れています。\nただし基準範囲との関係から読み取り確認が必要です。`,
        usedSource: replySource,
        canonical_normalized_key: primaryIntentKey,
        row: matchedRow
      };
    }
    return {
      replyText: `${name}として ${val}${u ? ` ${u}` : ''} が読み取られていますが、データ上の確認が必要です。原本の確認をおすすめします。`,
      usedSource: replySource,
      canonical_normalized_key: primaryIntentKey,
      row: matchedRow
    };
  }

  return {
    replyText: `${name}は ${val}${u ? ` ${u}` : ''} と読み取れています。`,
    usedSource: replySource,
    canonical_normalized_key: primaryIntentKey,
    row: matchedRow
  };
}

/**
 * 第1段階: canonical key（大文字小文字無視）
 * 第2段階: label fallback（同一セッション rows のみ）
 * 第3段階: resolver 側で parsed_items_json_fallback
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

  const emptyDebug = (extra = {}) => ({
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
    matchedRowSample: null,
    canonical_match_attempted: false,
    canonical_match_count: 0,
    label_fallback_attempted: false,
    label_fallback_used: false,
    labelFallbackTargetTerms: [],
    labelFallbackMatchedCount: 0,
    labelFallbackMatchedSample: null,
    uniqueFetchedKeys: [],
    uniqueFetchedNamesSample: [],
    finalUsedSource: null,
    finalResultCount: 0,
    labelHaystackSample: null,
    ...extra
  });

  if (!keys.length) {
    logReaderDebug(emptyDebug({ finalUsedSource: 'no_key_map', finalResultCount: 0 }));
    return {
      replyText: null,
      usedSource: 'no_key_map',
      row: null,
      canonical_normalized_key: null,
      tried_keys: []
    };
  }

  if (!Number.isFinite(sid)) {
    logReaderDebug(emptyDebug({ finalUsedSource: 'not_found', finalResultCount: 0 }));
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
    logReaderDebug(
      emptyDebug({
        repositoryError: pack.error,
        finalUsedSource: 'repository_error',
        finalResultCount: 0
      })
    );
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
  const canonical_match_count = countCanonicalMatches(allRows, keys);
  const uniqKeys = uniqueFetchedKeysSample(allRows);
  const uniqNames = uniqueFetchedNamesSample(allRows);

  let matchedRow = null;
  let matchedKey = null;
  let matchedHitCount = 0;
  let labelFallbackUsed = false;
  let labelFallbackAttempted = false;
  let labelFallbackMatchedCount = 0;
  let labelFallbackMatchedSample = null;
  const rawTermsForLog = LABEL_FALLBACK_TERMS_BY_TARGET[normalizeText(targetLabel)]
    ? LABEL_FALLBACK_TERMS_BY_TARGET[normalizeText(targetLabel)]
    : [normalizeText(targetLabel)].filter(Boolean);

  const canonical_match_attempted = true;

  for (const nk of keys) {
    const row = pickRowForCanonicalKey(allRows, nk, selectedDate);
    if (!row) continue;
    const hits = allRows.filter((r) => normalizeText(r.normalized_key).toLowerCase() === normalizeText(nk).toLowerCase());
    matchedHitCount = hits.length;
    matchedRow = row;
    matchedKey = nk;
    break;
  }

  if (!matchedRow && allRows.length > 0) {
    labelFallbackAttempted = true;
    const { hits, terms } = filterLabelFallbackHits(allRows, targetLabel);
    labelFallbackMatchedCount = hits.length;
    if (hits.length) {
      const first = hits[0];
      labelFallbackMatchedSample = {
        normalized_key: normalizeText(first.normalized_key),
        display_name: normalizeText(first.display_name).slice(0, 60),
        raw_name: normalizeText(first.raw_name).slice(0, 60),
        haystack: buildRowHaystack(first).slice(0, 120)
      };
    }
    const labelRow = pickBestAmongLabelHits(hits, selectedDate);
    if (labelRow) {
      matchedRow = labelRow;
      matchedKey = primaryCanonicalKey;
      matchedHitCount = 1;
      labelFallbackUsed = true;
    }
  }

  const labelHaystackSample =
    !matchedRow && allRows.length > 0
      ? allRows.slice(0, 5).map((r) => ({
          nk: normalizeText(r.normalized_key),
          hay: buildRowHaystack(r).slice(0, 100),
          disp: normalizeText(r.display_name).slice(0, 40)
        }))
      : null;

  const matchedRowSample = matchedRow
    ? {
        normalized_key: normalizeText(matchedRow.normalized_key),
        validation_status: normalizeText(matchedRow.validation_status),
        value_text: matchedRow.value_text != null ? String(matchedRow.value_text).slice(0, 48) : null,
        value_numeric: matchedRow.value_numeric
      }
    : null;

  if (!matchedRow) {
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
      matchedRowsCount: 0,
      matchedRowSample: null,
      canonical_match_attempted,
      canonical_match_count,
      label_fallback_attempted: labelFallbackAttempted,
      label_fallback_used: false,
      labelFallbackTargetTerms: rawTermsForLog,
      labelFallbackMatchedCount,
      labelFallbackMatchedSample,
      uniqueFetchedKeys: uniqKeys,
      uniqueFetchedNamesSample: uniqNames,
      finalUsedSource: 'not_found',
      finalResultCount: 0,
      labelHaystackSample
    });
    return {
      replyText: null,
      usedSource: 'not_found',
      row: null,
      canonical_normalized_key: primaryCanonicalKey,
      tried_keys: keys
    };
  }

  const replySource = labelFallbackUsed ? 'lab_result_items_label_fallback' : 'lab_result_items';
  const out = buildReplyForRow(matchedRow, detectedLabel, replySource, matchedKey);

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
    matchedRowsCount: matchedHitCount,
    matchedRowSample,
    canonical_match_attempted,
    canonical_match_count,
    label_fallback_attempted: labelFallbackAttempted,
    label_fallback_used: labelFallbackUsed,
    labelFallbackTargetTerms: rawTermsForLog,
    labelFallbackMatchedCount: labelFallbackUsed ? labelFallbackMatchedCount : 0,
    labelFallbackMatchedSample: labelFallbackUsed ? labelFallbackMatchedSample : null,
    uniqueFetchedKeys: uniqKeys,
    uniqueFetchedNamesSample: uniqNames,
    finalUsedSource: out.usedSource,
    finalResultCount: out.replyText ? 1 : 0,
    labelHaystackSample: null
  });

  return {
    replyText: out.replyText,
    usedSource: out.usedSource,
    row: out.row,
    canonical_normalized_key: out.canonical_normalized_key,
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
  logReaderDebug,
  buildRowHaystack,
  getLabelFallbackTerms
};
