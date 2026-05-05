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

async function getLatestLabResultByKey({ userId, normalizedKey, labSessionId }) {
  const uid = normalizeText(userId);
  const nk = normalizeText(normalizedKey);
  const sid = Number(labSessionId);
  if (!uid || !nk || !Number.isFinite(sid)) return null;
  const rows = await labResultItemRepository.fetchBySession({
    userId: uid,
    labSessionId: sid,
    excludeValidation: ['rejected', 'superseded']
  });
  const hit = rows.filter((r) => normalizeText(r.normalized_key) === nk);
  return hit.length ? hit.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] : null;
}

async function getLabResultsByKey({ userId, normalizedKey, limit = 10 }) {
  return labResultItemRepository.fetchLatestByUserAndKey({ userId, normalizedKey: normalizeText(normalizedKey), limit });
}

async function getReadableItemsForSession({ userId, labSessionId }) {
  const rows = await labResultItemRepository.fetchBySession({
    userId,
    labSessionId,
    excludeValidation: ['rejected']
  });
  return rows.filter((r) => normalizeText(r.value_text) || r.value_numeric != null);
}

async function getDistinctObservedDates({ userId, labSessionId }) {
  return labResultItemRepository.fetchDistinctObservedDatesForSession({ userId, labSessionId });
}

/**
 * @returns {{ replyText: string|null, usedSource: string, row: object|null, canonical_normalized_key: string|null, tried_keys: string[] }}
 */
async function buildItemFollowupReplyFromResults({
  userId,
  labSessionId,
  targetLabel,
  selectedDate
}) {
  const { keys, primaryCanonicalKey, detectedLabel } = await resolveCanonicalKeysForFollowup(targetLabel);
  if (!keys.length) {
    return {
      replyText: null,
      usedSource: 'no_key_map',
      row: null,
      canonical_normalized_key: null,
      tried_keys: []
    };
  }

  const uid = normalizeText(userId);
  const sid = Number(labSessionId);
  const allRows =
    uid && Number.isFinite(sid)
      ? await labResultItemRepository.fetchBySession({
        userId: uid,
        labSessionId: sid,
        excludeValidation: ['rejected', 'superseded']
      })
      : [];

  const pickRowForKey = (nk) => {
    const hit = allRows.filter((r) => normalizeText(r.normalized_key) === normalizeText(nk));
    if (!hit.length) return null;
    const sorted = hit.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    if (!selectedDate) return sorted[0];
    const want = String(selectedDate).slice(0, 10);
    const byDate = sorted.find((r) => r.observed_date && String(r.observed_date).slice(0, 10) === want);
    return byDate || sorted[0];
  };

  for (const nk of keys) {
    const row = pickRowForKey(nk);
    if (!row) continue;
    if (selectedDate) {
      const want = String(selectedDate).slice(0, 10);
      if (row.observed_date && String(row.observed_date).slice(0, 10) !== want) continue;
    }
    const u = normalizeText(row.unit);
    const val = row.value_text != null ? String(row.value_text) : String(row.value_numeric ?? '');
    const name = normalizeText(row.display_name) || detectedLabel;
    if (!val) {
      return {
        replyText: null,
        usedSource: 'empty_value',
        row,
        canonical_normalized_key: nk,
        tried_keys: keys
      };
    }
    if (row.validation_status === 'needs_manual_review') {
      return {
        replyText: `${name}として ${val}${u ? ` ${u}` : ''} が読み取られていますが、データ上の確認が必要です。原本の確認をおすすめします。`,
        usedSource: 'lab_result_items',
        row,
        canonical_normalized_key: nk,
        tried_keys: keys
      };
    }
    return {
      replyText: `${name}は ${val}${u ? ` ${u}` : ''} と読み取れています。`,
      usedSource: 'lab_result_items',
      row,
      canonical_normalized_key: nk,
      tried_keys: keys
    };
  }

  return {
    replyText: null,
    usedSource: 'not_found',
    row: null,
    canonical_normalized_key: primaryCanonicalKey,
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
async function buildInventorySummaryFromSession({ userId, labSessionId }) {
  const rows = await getReadableItemsForSession({ userId, labSessionId });
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
  logResultItemsSource
};
