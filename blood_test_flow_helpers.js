'use strict';

/**
 * 血液検査の複数日読み取り結果を、一時保持・正規化・一括保存前プレビューするヘルパー
 */

const LAB_PENDING_TTL_MS = 1000 * 60 * 30; // 30分

// メモリ保持
const pendingLabSessions = new Map();

function nowIso() {
  return new Date().toISOString();
}

function isValidDateString(v) {
  if (!v || typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function normalizeExamDate(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  let s = String(value).trim();
  if (!s) return null;

  s = s
    .replace(/[年/.]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/\s+/g, '')
    .replace(/--+/g, '-');

  // YYYY-M-D っぽいものを YYYY-MM-DD へ
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const yyyy = m[1];
    const mm = String(Number(m[2])).padStart(2, '0');
    const dd = String(Number(m[3])).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  if (isValidDateString(s)) {
    return new Date(s).toISOString().slice(0, 10);
  }

  return null;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  const s = String(v).trim().replace(/,/g, '');
  if (!s) return null;

  // 例: "123 mg/dL" から数字だけ拾う
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;

  const num = Number(m[0]);
  return Number.isFinite(num) ? num : null;
}

function normalizeLabRow(raw = {}) {
  const row = {
    exam_date: normalizeExamDate(raw.exam_date || raw.date || raw.measured_at),
    height: toNumberOrNull(raw.height),
    weight: toNumberOrNull(raw.weight),
    bmi: toNumberOrNull(raw.bmi),
    abdominal_circumference: toNumberOrNull(raw.abdominal_circumference || raw.waist),

    systolic_bp: toNumberOrNull(raw.systolic_bp || raw.bp_high || raw.sbp),
    diastolic_bp: toNumberOrNull(raw.diastolic_bp || raw.bp_low || raw.dbp),

    ast: toNumberOrNull(raw.ast),
    alt: toNumberOrNull(raw.alt),
    gamma_gtp: toNumberOrNull(raw.gamma_gtp || raw.ggt || raw.gamma),

    triglyceride: toNumberOrNull(raw.triglyceride || raw.tg),
    hdl: toNumberOrNull(raw.hdl),
    ldl: toNumberOrNull(raw.ldl),

    fasting_glucose: toNumberOrNull(raw.fasting_glucose || raw.glucose || raw.bs),
    hba1c: toNumberOrNull(raw.hba1c),
    uric_acid: toNumberOrNull(raw.uric_acid || raw.ua),
    creatinine: toNumberOrNull(raw.creatinine || raw.cre),

    hemoglobin: toNumberOrNull(raw.hemoglobin || raw.hb),
    hematocrit: toNumberOrNull(raw.hematocrit || raw.ht),
    rbc: toNumberOrNull(raw.rbc),
    wbc: toNumberOrNull(raw.wbc),

    total_protein: toNumberOrNull(raw.total_protein || raw.tp),
    albumin: toNumberOrNull(raw.albumin || raw.alb),
    bun: toNumberOrNull(raw.bun),
    egfr: toNumberOrNull(raw.egfr),
  };

  return row;
}

function rowHasAnyLabValue(row) {
  if (!row || typeof row !== 'object') return false;
  const keys = Object.keys(row).filter((k) => k !== 'exam_date');
  return keys.some((k) => row[k] !== null && row[k] !== undefined);
}

function buildRowSignature(row) {
  const keys = Object.keys(row).sort();
  return keys.map((k) => `${k}:${row[k] ?? ''}`).join('|');
}

function dedupeRows(rows = []) {
  const seen = new Set();
  const out = [];

  for (const row of rows) {
    if (!row || !row.exam_date) continue;
    if (!rowHasAnyLabValue(row)) continue;

    const sig = buildRowSignature(row);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(row);
  }

  out.sort((a, b) => {
    if (a.exam_date < b.exam_date) return -1;
    if (a.exam_date > b.exam_date) return 1;
    return 0;
  });

  return out;
}

function normalizeRows(rows = []) {
  return dedupeRows(
    rows
      .map((r) => normalizeLabRow(r))
      .filter((r) => r.exam_date && rowHasAnyLabValue(r))
  );
}

function getPendingLabSession(userId) {
  if (!userId) return null;

  const item = pendingLabSessions.get(userId);
  if (!item) return null;

  if (item.expires_at && new Date(item.expires_at).getTime() < Date.now()) {
    pendingLabSessions.delete(userId);
    return null;
  }

  return item;
}

function setPendingLabSession(userId, payload) {
  if (!userId) return null;

  const session = {
    import_session_id: payload.import_session_id || null,
    source_image_url: payload.source_image_url || null,
    ai_summary: payload.ai_summary || null,
    rows: normalizeRows(payload.rows || []),
    created_at: nowIso(),
    updated_at: nowIso(),
    expires_at: new Date(Date.now() + LAB_PENDING_TTL_MS).toISOString(),
  };

  pendingLabSessions.set(userId, session);
  return session;
}

function mergePendingLabSession(userId, payload) {
  if (!userId) return null;

  const current = getPendingLabSession(userId);

  if (!current) {
    return setPendingLabSession(userId, payload);
  }

  const merged = {
    ...current,
    import_session_id: payload.import_session_id || current.import_session_id || null,
    source_image_url: payload.source_image_url || current.source_image_url || null,
    ai_summary: payload.ai_summary || current.ai_summary || null,
    rows: normalizeRows([...(current.rows || []), ...(payload.rows || [])]),
    updated_at: nowIso(),
    expires_at: new Date(Date.now() + LAB_PENDING_TTL_MS).toISOString(),
  };

  pendingLabSessions.set(userId, merged);
  return merged;
}

function clearPendingLabSession(userId) {
  if (!userId) return;
  pendingLabSessions.delete(userId);
}

function isLabSaveIntent(text = '') {
  const s = String(text || '').trim();
  if (!s) return false;

  return [
    '保存',
    '一括保存',
    'まとめて保存',
    '全部保存',
    'この内容で保存',
    'はい保存',
    'これで保存',
    '確定',
    '登録',
  ].some((kw) => s.includes(kw));
}

function isLabCancelIntent(text = '') {
  const s = String(text || '').trim();
  if (!s) return false;

  return [
    'キャンセル',
    '保存しない',
    'やめる',
    '破棄',
    '取り消し',
  ].some((kw) => s.includes(kw));
}

function buildPendingLabPreviewMessage(session) {
  const rows = session?.rows || [];
  if (!rows.length) {
    return '血液検査の保存候補が見つかりませんでした。';
  }

  const dates = rows.map((r) => r.exam_date);
  const first = dates[0];
  const last = dates[dates.length - 1];

  const lines = [];
  lines.push(`血液検査を ${rows.length}件 読み取りました。`);
  lines.push(`対象日: ${first}${first !== last ? ` 〜 ${last}` : ''}`);
  lines.push('');
  lines.push('保存してよければ「一括保存」と送ってください。');
  lines.push('やめる場合は「キャンセル」で破棄できます。');

  return lines.join('\n');
}

module.exports = {
  normalizeExamDate,
  normalizeLabRow,
  normalizeRows,
  getPendingLabSession,
  setPendingLabSession,
  mergePendingLabSession,
  clearPendingLabSession,
  isLabSaveIntent,
  isLabCancelIntent,
  buildPendingLabPreviewMessage,
};
