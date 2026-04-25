'use strict';

const geminiDispatchService = require('./gemini_dispatch_service');
const { buildLabMatrixExtractSpec } = require('./lab_extract_prompt_builder_service');
const labIngestTrace = require('./lab_ingest_trace_service');
const { KEY_TO_ITEM_NAME } = require('./lab_lab_display_names');

function normalizeText(v) {
  return String(v || '').trim();
}

function normalizeYmdToken(v) {
  const s = normalizeText(v).replace(/\//g, '-');
  const m = s.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

function toNumberOrNull(v) {
  const raw = normalizeText(v).replace(/,/g, '');
  if (!raw) return null;
  if (!/^[-+]?\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function buildMatrixDiagnostics(rows = []) {
  const headerCandidates = [];
  const headerRejected = [];
  const rowCandidates = [];
  const rowRejected = [];
  const cellCandidates = [];
  const cellRejected = [];
  const unitsFound = new Set();
  const flagsFound = new Set();
  const mappings = [];

  for (const r of Array.isArray(rows) ? rows : []) {
    const observedDate = normalizeYmdToken(r?.date || r?.observedDate || r?.observed_date || '');
    if (observedDate) headerCandidates.push(observedDate);
    else headerRejected.push('invalid_or_missing_date');

    const label = normalizeText(r?.label_in_image || r?.rawName || r?.name || '');
    const normalizedKey = normalizeText(r?.normalized_key || r?.normalizedKey || '');
    if (label) {
      if (normalizedKey) rowCandidates.push(normalizedKey);
      else rowRejected.push('normalized_key_not_found');
    } else {
      rowRejected.push('missing_row_label');
    }

    const valueRaw = normalizeText(r?.value);
    const valueNum = toNumberOrNull(valueRaw);
    const unit = normalizeText(r?.unit || '');
    const flag = normalizeText(r?.flag || '').toUpperCase();
    if (unit) unitsFound.add(unit);
    if (flag === 'H' || flag === 'L') flagsFound.add(flag);
    if (!valueRaw) {
      cellRejected.push('empty_value');
    } else if (valueNum == null) {
      cellRejected.push('non_numeric_value');
    } else {
      cellCandidates.push(valueRaw);
    }

    if (observedDate && normalizedKey && valueNum != null) {
      mappings.push({ observedDate, normalizedKey, value: valueRaw });
    }
  }

  const headersDistinct = Array.from(new Set(headerCandidates));
  const majorKeys = new Set([
    'triglycerides_tg',
    'ldl_cholesterol',
    'hdl_cholesterol',
    'ast_got',
    'alt_gpt',
    'gamma_gtp',
    'hba1c',
    'creatinine'
  ]);
  const majorCount = rowCandidates.filter((k) => majorKeys.has(k)).length;
  const reason = (() => {
    if (!headersDistinct.length) return 'no_date_headers';
    if (!rowCandidates.length) return rowRejected.includes('normalized_key_not_found') ? 'normalized_key_not_found' : 'no_row_labels';
    if (!cellCandidates.length) return cellRejected.includes('non_numeric_value') ? 'all_values_rejected' : 'no_numeric_cells';
    if (!mappings.length) return 'mapping_failed_due_to_grid_alignment';
    return '';
  })();

  return {
    headersDistinct,
    headerRejected,
    rowCandidates,
    rowRejected,
    majorCount,
    cellCandidates,
    cellRejected,
    unitsFound: [...unitsFound],
    flagsFound: [...flagsFound],
    mappings,
    reason
  };
}

/**
 * 複数日付表（matrix）専用の2nd pass。単票用スキーマで落ちた行項目を救う。
 */
async function extractMatrixTable(imagePayload, meta = {}) {
  const spec = buildLabMatrixExtractSpec(meta);
  try {
    const dispatch = await geminiDispatchService.generateStructuredImageJson({
      imagePayload,
      prompt: spec.prompt,
      schema: spec.schema,
      domain: 'lab_multi_date_matrix',
      model: spec.preferredModel,
      temperature: 0.05,
      maxOutputTokens: 4096
    });
    if (!dispatch?.ok) {
      const reason = normalizeText(dispatch?.error?.message || 'matrix_dispatch_failed');
      console.info('[phasee-new] lab_matrix_header_extract', {
        userId: meta.userId || '',
        date_header_candidates: 0,
        observed_date_count: 0,
        observed_dates: [],
        rejected_headers: [reason || 'no_date_headers'],
        reason: 'no_date_headers'
      });
      console.info('[phasee-new] lab_matrix_row_label_extract', {
        userId: meta.userId || '',
        row_label_candidates: 0,
        normalized_key_count: 0,
        major_key_count: 0,
        raw_row_labels_sample: [],
        rejected_row_labels: [reason || 'no_row_labels'],
        reason: 'no_row_labels'
      });
      console.info('[phasee-new] lab_matrix_cell_value_extract', {
        userId: meta.userId || '',
        numeric_cell_count: 0,
        numeric_cells_sample: [],
        units_found: [],
        flags_found: [],
        rejected_cells: [reason || 'no_numeric_cells'],
        reason: 'no_numeric_cells'
      });
      console.info('[phasee-new] lab_matrix_mapping', {
        userId: meta.userId || '',
        mapping_count: 0,
        matrix_cell_count: 0,
        reason: 'matrix_detected_but_empty'
      });
      return { ok: false, data: [], raw: null, error: String(dispatch?.error?.message || 'matrix_dispatch_failed') };
    }
    const json = dispatch.json || {};
    const rows = Array.isArray(json.data) ? json.data : [];
    const diag = buildMatrixDiagnostics(rows);
    console.info('[phasee-new] lab_matrix_header_extract', {
      userId: meta.userId || '',
      date_header_candidates: rows.length,
      observed_date_count: diag.headersDistinct.length,
      observed_dates: diag.headersDistinct,
      rejected_headers: diag.headerRejected.slice(0, 20),
      reason: diag.headersDistinct.length ? '' : 'no_date_headers'
    });
    console.info('[phasee-new] lab_matrix_row_label_extract', {
      userId: meta.userId || '',
      row_label_candidates: rows.length,
      normalized_key_count: diag.rowCandidates.length,
      major_key_count: diag.majorCount,
      raw_row_labels_sample: rows.map((r) => normalizeText(r?.label_in_image || r?.rawName || r?.name || '')).filter(Boolean).slice(0, 12),
      rejected_row_labels: diag.rowRejected.slice(0, 20),
      reason: diag.rowCandidates.length ? '' : (diag.reason === 'normalized_key_not_found' ? 'normalized_key_not_found' : 'no_row_labels')
    });
    console.info('[phasee-new] lab_matrix_cell_value_extract', {
      userId: meta.userId || '',
      numeric_cell_count: diag.cellCandidates.length,
      numeric_cells_sample: diag.cellCandidates.slice(0, 12),
      units_found: diag.unitsFound,
      flags_found: diag.flagsFound,
      rejected_cells: diag.cellRejected.slice(0, 20),
      reason: diag.cellCandidates.length ? '' : (diag.reason === 'all_values_rejected' ? 'all_values_rejected' : 'no_numeric_cells')
    });
    console.info('[phasee-new] lab_matrix_mapping', {
      userId: meta.userId || '',
      mapping_count: diag.mappings.length,
      matrix_cell_count: diag.mappings.length,
      distinct_observed_dates_count: Array.from(new Set(diag.mappings.map((m) => m.observedDate))).length,
      mapped_keys_count: Array.from(new Set(diag.mappings.map((m) => m.normalizedKey))).length,
      reason: diag.reason || ''
    });
    console.info('[phasee-new] lab_multi_date_matrix_extract', {
      userId: meta.userId || '',
      item_count: rows.length,
      observed_date_count: diag.headersDistinct.length,
      major_key_count: rows.filter((r) => {
        const k = normalizeText(String(r?.normalized_key || r?.normalizedKey || '').toLowerCase());
        return ['triglycerides_tg', 'ldl_cholesterol', 'hdl_cholesterol', 'ast_got', 'alt_gpt', 'gamma_gtp', 'hba1c', 'creatinine', 'glucose', 'uric_acid', 'total_cholesterol'].includes(k);
      }).length
    });
    labIngestTrace.logPreInsert({
      userId: meta.userId,
      insertPayload: { source: 'lab_matrix_extract', item_count: rows.length, document_layout: 'lab_multi_date_matrix' }
    });
    return { ok: rows.length > 0, data: rows, raw: json };
  } catch (e) {
    console.info('[phasee-new] lab_matrix_header_extract', {
      userId: meta.userId || '',
      date_header_candidates: 0,
      observed_date_count: 0,
      observed_dates: [],
      rejected_headers: [String(e?.message || 'matrix_exception').slice(0, 160)],
      reason: 'matrix_detected_but_empty'
    });
    console.info('[phasee-new] lab_matrix_row_label_extract', {
      userId: meta.userId || '',
      row_label_candidates: 0,
      normalized_key_count: 0,
      major_key_count: 0,
      raw_row_labels_sample: [],
      rejected_row_labels: [String(e?.message || 'matrix_exception').slice(0, 160)],
      reason: 'matrix_detected_but_empty'
    });
    console.info('[phasee-new] lab_matrix_cell_value_extract', {
      userId: meta.userId || '',
      numeric_cell_count: 0,
      numeric_cells_sample: [],
      units_found: [],
      flags_found: [],
      rejected_cells: [String(e?.message || 'matrix_exception').slice(0, 160)],
      reason: 'matrix_detected_but_empty'
    });
    console.info('[phasee-new] lab_matrix_mapping', {
      userId: meta.userId || '',
      mapping_count: 0,
      matrix_cell_count: 0,
      reason: 'matrix_detected_but_empty'
    });
    return { ok: false, data: [], raw: null, error: String(e?.message || e) };
  }
}

/**
 * 主要項目の軽量テキスト救済（表の一部だけ取れれば可）
 */
async function extractMatrixMajorRescueText(imagePayload, meta = {}) {
  const prompt = [
    'あなたは日本語の健康診断/血液検査の「表」専用OCRです。プレーンテキストのみ返してください。JSONは禁止。',
    '画像に複数の採血日/検査日列がある表があれば、行ラベル（例: 中性脂肪,HbA1c,LDL,HDL,AST,ALT,γ-GTP,クレアチニン,空腹時血糖,尿酸,総コレ...）に対し、日付列ごとに数値を書いてください。',
    '1行の例: 中性脂肪 | 2024-01-10: 120 / 2024-04-10: 95',
    '日付に数字が取れない列は推測で埋めないで「?」',
    '日付行だけ、見出しだけ、は禁止。必ず数値行を出してください。'
  ].join('\n');
  try {
    const result = await geminiDispatchService.generateTextFromImage({
      prompt,
      imagePayload,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
    });
    return normalizeText(result?.text || result || '');
  } catch (_e) {
    return '';
  }
}

async function extractMatrixRescueTsvText(imagePayload) {
  const prompt = [
    '血液検査の複数日付表を読み取り、以下のTSV形式のみを返してください。',
    '1行 = item_label<TAB>observed_date(YYYY-MM-DD)<TAB>value<TAB>unit<TAB>flag',
    '例: 中性脂肪<TAB>2025-03-22<TAB>145<TAB>mg/dL<TAB>H',
    '日付が2つ以上ある場合は、同じ項目を日付ごとに複数行出してください。',
    '日付行だけ、見出しだけは禁止。値がある行だけ返してください。'
  ].join('\n');
  try {
    const result = await geminiDispatchService.generateTextFromImage({
      prompt,
      imagePayload,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
    });
    return normalizeText(result?.text || result || '');
  } catch (_e) {
    return '';
  }
}

function parseTsvRowsToDataRows(text) {
  const out = [];
  const lines = normalizeText(text).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  for (const line of lines) {
    const cols = line.split('\t').map((x) => normalizeText(x));
    if (cols.length < 3) continue;
    const rawLabel = cols[0];
    const observedDate = normalizeYmdToken(cols[1]);
    const value = cols[2];
    if (!rawLabel || !observedDate || !value) continue;
    out.push({
      label_in_image: rawLabel,
      normalized_key: guessKeyFromLabel(rawLabel) || `raw_label:${rawLabel.toLowerCase()}`,
      date: observedDate,
      value,
      unit: cols[3] || '',
      flag: cols[4] || '',
      source: 'matrix_tsv_rescue',
      status: 'rescued_from_tsv'
    });
  }
  return out;
}

/**
 * 救済テキストを粗い行にパース（最低限主要キー用）
 */
function majorRescueTextToDataRows(text) {
  const safe = normalizeText(text);
  if (!safe) return [];
  const out = [];
  for (const line of safe.split(/\n/)) {
    const m = line.match(/^(.+?)\s*[\|｜:：]\s*(.+)$/u);
    if (!m) continue;
    const label = normalizeText(m[1]);
    const rest = m[2];
    const reDateVal = /(20\d{2}[-\/]?\d{1,2}[-\/]?\d{1,2})\s*[:：]?\s*([0-9.]+)/g;
    let mm;
    while ((mm = reDateVal.exec(rest)) !== null) {
      const rawD = mm[1].replace(/\//g, '-');
      const p = rawD.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
      const ymd = p ? `${p[1]}-${String(p[2]).padStart(2, '0')}-${String(p[3]).padStart(2, '0')}` : '';
      if (!ymd) continue;
      out.push({
        label_in_image: label,
        normalized_key: guessKeyFromLabel(label),
        date: ymd,
        value: mm[2],
        source: 'major_text_rescue',
        status: 'rescued_from_matrix_text'
      });
    }
  }
  return out;
}

function guessKeyFromLabel(lab) {
  const t = normalizeText(lab).toLowerCase();
  if (t.includes('中性脂肪') || t.includes('tg') || t.includes('トリグリ')) return 'triglycerides_tg';
  if (t.includes('ldl') && t.includes('hdl') && t.includes('比')) return 'ldl_hdl_ratio';
  if (t.includes('ldl') || t.includes('悪玉')) return 'ldl_cholesterol';
  if (t.includes('hdl') || t.includes('善玉')) return 'hdl_cholesterol';
  if (t.includes('hba1c') || t.includes('糖化')) return 'hba1c';
  if (t.includes('ast') || t.includes('got')) return 'ast_got';
  if (t.includes('alt') || t.includes('gpt')) return 'alt_gpt';
  if (t.includes('ggt') || t.includes('gtp') || t.includes('γ')) return 'gamma_gtp';
  if (t.includes('クレア') || t.includes('cre') || t.includes('cr ')) return 'creatinine';
  if (t.includes('空腹') && t.includes('糖')) return 'glucose';
  if (t.includes('尿酸') || t === 'ua') return 'uric_acid';
  if (t.includes('総コレ') || t.includes('t-cho') || t === 'chol') return 'total_cholesterol';
  return '';
}

module.exports = {
  extractMatrixTable,
  extractMatrixMajorRescueText,
  extractMatrixRescueTsvText,
  parseTsvRowsToDataRows,
  majorRescueTextToDataRows,
  buildMatrixDiagnostics
};
