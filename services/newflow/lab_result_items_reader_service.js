'use strict';

const labResultItemRepository = require('../../repositories/lab_result_item_repository');

function normalizeText(v) {
  return String(v || '').trim();
}

/** lab_followup の項目ラベル → lab_item_master.normalized_key */
function canonicalKeysForTargetLabel(targetLabel) {
  const t = normalizeText(targetLabel);
  const map = {
    中性脂肪: ['triglycerides_tg'],
    TG: ['triglycerides_tg'],
    HbA1c: ['hba1c'],
    LDL: ['ldl_cholesterol'],
    HDL: ['hdl_cholesterol'],
    血糖: ['glucose'],
    AST: ['ast_got'],
    ALT: ['alt_gpt'],
    'γ-GTP': ['ggt'],
    'γGTP': ['ggt'],
    LDH: ['ldh'],
    クレアチニン: ['creatinine'],
    ヘモグロビン: ['hemoglobin'],
    総コレステロール: ['total_cholesterol'],
    尿酸: ['uric_acid'],
    白血球数: ['wbc'],
    赤血球数: ['rbc'],
    血小板数: ['platelet'],
    尿素窒素: ['bun'],
    eGFR: ['egfr'],
    総蛋白: ['total_protein'],
    アルブミン: ['albumin'],
    CRP: ['crp'],
    CPK: ['cpk'],
    'LDL/HDL比': ['ldl_cholesterol', 'hdl_cholesterol']
  };
  if (map[t]) return map[t];
  return [];
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
 * @returns {{ replyText: string|null, usedSource: string, row: object|null }}
 */
async function buildItemFollowupReplyFromResults({
  userId,
  labSessionId,
  targetLabel,
  selectedDate
}) {
  const keys = canonicalKeysForTargetLabel(targetLabel);
  if (!keys.length) return { replyText: null, usedSource: 'no_key_map', row: null };
  for (const nk of keys) {
    const row = await getLatestLabResultByKey({ userId, normalizedKey: nk, labSessionId });
    if (!row) continue;
    if (selectedDate) {
      const want = String(selectedDate).slice(0, 10);
      if (row.observed_date && String(row.observed_date).slice(0, 10) !== want) continue;
    }
    const u = normalizeText(row.unit);
    const val = row.value_text != null ? String(row.value_text) : String(row.value_numeric ?? '');
    const name = normalizeText(row.display_name) || targetLabel;
    if (!val) return { replyText: null, usedSource: 'empty_value', row };
    if (row.validation_status === 'needs_manual_review') {
      return {
        replyText: `${name}として ${val}${u ? ` ${u}` : ''} が読み取られていますが、${normalizeText(row.review_reason) ? 'データ上の確認が必要です' : '確認が必要です'}。原本の確認をおすすめします。`,
        usedSource: 'lab_result_items',
        row
      };
    }
    return {
      replyText: `${name}は ${val}${u ? ` ${u}` : ''} と読み取れています。`,
      usedSource: 'lab_result_items',
      row
    };
  }
  return { replyText: null, usedSource: 'not_found', row: null };
}

function logResultItemsSource(payload) {
  console.info('[lab_followup_result_items_source]', payload);
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
  canonicalKeysForTargetLabel,
  logResultItemsSource
};
