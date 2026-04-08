'use strict';

const { textMessageWithQuickReplies } = require('./line_service');
const labFollowupService = require('./lab_followup_service');

const ITEM_ALIASES = [
  { key: 'triglycerides_tg', label: 'TG', aliases: ['中性脂肪', 'TG', 'トリグリセリド'] },
  { key: 'hba1c', label: 'HbA1c', aliases: ['HBA1C', 'HbA1c', 'A1c', 'ヘモグロビンA1c'] },
  { key: 'ldl_cholesterol', label: 'LDL', aliases: ['LDL', 'LDLコレステロール', 'LDL-C'] },
  { key: 'hdl_cholesterol', label: 'HDL', aliases: ['HDL', 'HDLコレステロール', 'HDL-C'] },
  { key: 'total_cholesterol', label: '総コレステロール', aliases: ['総コレステロール', 'T-CHO', 'CHO'] },
  { key: 'ast_got', label: 'AST', aliases: ['AST', 'GOT', 'AST(GOT)'] },
  { key: 'alt_gpt', label: 'ALT', aliases: ['ALT', 'GPT', 'ALT(GPT)'] },
  { key: 'cpk', label: 'CPK', aliases: ['CPK', 'CK'] },
  { key: 'egfr', label: 'eGFR', aliases: ['eGFR', 'GFR'] },
  { key: 'creatinine', label: 'クレアチニン', aliases: ['クレアチニン', 'Cre', 'CRE'] },
];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeDateToken(token) {
  const safe = normalizeText(token);
  if (!safe) return '';
  let m = safe.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = safe.match(/(20\d{2})[\/\.年]\s*(\d{1,2})[\/\.月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = safe.match(/([0-9]{2})[\/\.\-]\s*(\d{1,2})[\/\.\-]\s*(\d{1,2})/);
  if (m) {
    const yy = Number(m[1]);
    const yyyy = yy <= 39 ? 2000 + yy : 1900 + yy;
    return `${yyyy}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  m = safe.match(/R\s*(\d+)[\.\/\-](\d{1,2})[\.\/\-](\d{1,2})/i);
  if (m) {
    const year = 2018 + Number(m[1]);
    return `${year}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  return '';
}

function resolveAliasSpec(text) {
  const safe = normalizeText(text).toLowerCase();
  if (!safe) return null;
  for (const spec of ITEM_ALIASES) {
    for (const alias of spec.aliases) {
      if (safe.includes(String(alias).toLowerCase())) return spec;
    }
  }
  const normalizedTarget = labFollowupService.normalizeTarget(text);
  if (!normalizedTarget) return null;
  return ITEM_ALIASES.find((spec) => spec.label === normalizedTarget) || null;
}

function isAcceptanceText(text) {
  const safe = normalizeText(text);
  return /^(はい|OK|ok|このまま保存|保存して|これで保存|合っています|合ってる)$/i.test(safe);
}

function hasSaveIntentText(text) {
  const safe = normalizeText(text);
  return /保存/.test(safe);
}

function isCorrectionStartText(text) {
  const safe = normalizeText(text);
  return /^(いいえ|修正|修正する|違う|違います|数値を修正する)$/i.test(safe);
}

function isDateCorrectionStartText(text) {
  const safe = normalizeText(text);
  return /^(日付を修正する|日付修正|日付が違う|日付違う)$/i.test(safe);
}

function extractExplicitDate(text) {
  return normalizeDateToken(text);
}

function parseDateOverride(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  if (!/日付/.test(safe) && !/検査日/.test(safe)) return null;
  const date = normalizeDateToken(safe);
  return date || null;
}

function parseCorrections(text) {
  const safe = normalizeText(text);
  if (!safe) return [];
  const date = extractExplicitDate(safe);
  const corrections = [];

  for (const spec of ITEM_ALIASES) {
    for (const alias of spec.aliases) {
      const escaped = String(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`${escaped}\\s*(?:は|:|：|=)?\\s*(-?\\d+(?:\\.\\d+)?)`, 'i');
      const match = safe.match(regex);
      if (!match) continue;
      corrections.push({
        normalized_key: spec.key,
        label: spec.label,
        date: date || null,
        value: Number(match[1]),
      });
      break;
    }
  }

  return corrections;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sortDatesAsc(list = []) {
  return [...new Set((list || []).map(normalizeDateToken).filter(Boolean))].sort();
}

function applyCorrectionsToNormalized(normalized = {}, text = '') {
  const next = clone(normalized) || {};
  const rows = Array.isArray(next.measurements) ? next.measurements.slice() : [];
  const corrections = parseCorrections(text);
  const dateOverride = parseDateOverride(text);

  if (dateOverride) {
    const uniqueDates = sortDatesAsc(rows.map((row) => row?.date));
    if (uniqueDates.length <= 1) {
      for (const row of rows) row.date = dateOverride;
    }
    next.measurements = rows;
    next.confirmation_hint = `日付を ${dateOverride} に修正しました。`;
    return { normalized: next, appliedCorrections: [], dateOverride };
  }

  if (!corrections.length) {
    return { normalized: next, appliedCorrections: [], dateOverride: null };
  }

  const availableDates = sortDatesAsc(rows.map((row) => row?.date));

  for (const correction of corrections) {
    const targetDate = correction.date || (availableDates.length === 1 ? availableDates[0] : '');
    let applied = false;
    for (const row of rows) {
      if (row?.normalized_key !== correction.normalized_key) continue;
      if (targetDate && normalizeDateToken(row?.date) !== targetDate) continue;
      row.value = correction.value;
      if (correction.label) row.label = correction.label;
      applied = true;
    }
    if (!applied) {
      rows.push({
        date: targetDate || availableDates[availableDates.length - 1] || '',
        label: correction.label,
        normalized_key: correction.normalized_key,
        unit: null,
        value: correction.value,
      });
    }
  }

  next.measurements = rows;
  return { normalized: next, appliedCorrections: corrections, dateOverride: null };
}

function summarizeImportantLines(panel) {
  const priorities = ['中性脂肪', 'HbA1c', 'LDL', 'HDL', '総コレステロール', 'AST'];
  const lines = [];
  for (const name of priorities) {
    const item = (panel?.items || []).find((candidate) => candidate?.itemName === name && normalizeText(candidate?.value));
    if (!item) continue;
    const unit = item.unit ? ` ${item.unit}` : '';
    lines.push(`・${item.itemName}: ${item.value}${unit}`);
  }
  return lines.slice(0, 6);
}

function buildDraftSummaryMessage(panel, options = {}) {
  const dates = sortDatesAsc(panel?.examDates || [panel?.latestExamDate || panel?.examDate || '']);
  const importantLines = summarizeImportantLines(panel);
  const lines = [
    '血液検査を読み取りました。まずは仮の読み取りとして確認してください。',
    dates.length ? `読み取れた日付: ${dates.join(' / ')}` : '日付はまだ仮置きです。',
    ...importantLines,
    importantLines.length ? null : '今回は自動読み取りが弱めなので、合っている項目だけ「TGは50」「HbA1cは5.8」のように送ってください。',
    options?.hint || null,
    'この読み取りでよければ「はい、このまま保存」、違う時は「いいえ、修正する」を押してください。',
    'そのまま「TGは50」「HbA1cは5.8」のように直しても大丈夫です。',
  ].filter(Boolean).join('\n');

  return textMessageWithQuickReplies(lines, ['はい、このまま保存', 'いいえ、修正する', '日付は2025-03-22']);
}

function buildCorrectionGuideMessage() {
  const text = [
    'ありがとうございます。直したい項目だけ送ってください。',
    '例:',
    '・TGは50',
    '・HbA1cは5.8',
    '・TGは50、LDLは148',
    '日付も違う時は「日付は2025-03-22」のように送ってください。',
  ].join('\n');
  return textMessageWithQuickReplies(text, ['TGは50', 'HbA1cは5.8', '日付は2025-03-22']);
}

function buildDateCorrectionGuideMessage() {
  const text = [
    '日付だけ直したい時は、',
    '「日付は2025-03-22」のように送ってください。',
    '1日分の検査ならその日付に直します。',
  ].join('\n');
  return textMessageWithQuickReplies(text, ['日付は2025-03-22', '日付は2025-10-09']);
}

function buildSavedReply(panel) {
  const dates = sortDatesAsc(panel?.examDates || [panel?.latestExamDate || panel?.examDate || '']);
  return [
    '確認ありがとうございます。血液検査をこの内容で保存しました。',
    dates.length ? `保存した日付: ${dates.join(' / ')}` : null,
    'このあと「TGは？」「HbA1cは？」「今までの傾向は？」のように聞いて大丈夫です。',
  ].filter(Boolean).join('\n');
}

function buildPendingItemReply(panel, text, selectedDate = '') {
  const target = labFollowupService.normalizeTarget(text);
  if (!target) return null;
  const date = extractExplicitDate(text) || selectedDate || panel?.latestExamDate || panel?.examDate || '';
  const core = labFollowupService.buildItemReply(panel, target, date);
  const example = target === '中性脂肪' ? 'TGは50' : `${target}は...`;
  return `${core}
仮読み取りの段階なので、合っていれば「はい、このまま保存」、違えば「${example}」のように直してください。`;
}

function isPendingLabQuestion(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  return Boolean(labFollowupService.normalizeTarget(safe)) || labFollowupService.shouldHandleTrendQuestion(safe);
}

module.exports = {
  isAcceptanceText,
  isCorrectionStartText,
  isDateCorrectionStartText,
  isPendingLabQuestion,
  parseCorrections,
  parseDateOverride,
  applyCorrectionsToNormalized,
  buildDraftSummaryMessage,
  buildCorrectionGuideMessage,
  buildDateCorrectionGuideMessage,
  buildSavedReply,
  buildPendingItemReply,
  sortDatesAsc,
  hasSaveIntentText,
};
