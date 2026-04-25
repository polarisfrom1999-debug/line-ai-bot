'use strict';

const geminiDispatchService = require('./gemini_dispatch_service');
const { buildLabMatrixExtractSpec } = require('./lab_extract_prompt_builder_service');
const labIngestTrace = require('./lab_ingest_trace_service');
const { KEY_TO_ITEM_NAME } = require('./lab_lab_display_names');
const geminiImageAnalysisService = require('./gemini_image_analysis_service');

function normalizeText(v) {
  return String(v || '').trim();
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
      return { ok: false, data: [], raw: null, error: String(dispatch?.error?.message || 'matrix_dispatch_failed') };
    }
    const json = dispatch.json || {};
    const rows = Array.isArray(json.data) ? json.data : [];
    const observedDates = new Set();
    for (const r of rows) {
      const d = normalizeText(r?.date || r?.observedDate || r?.observed_date || '');
      if (d) {
        const parts = d.match(/(20\d{2}-\d{2}-\d{2})/);
        if (parts) observedDates.add(parts[1]);
      }
    }
    console.info('[phasee-new] lab_multi_date_matrix_extract', {
      userId: meta.userId || '',
      item_count: rows.length,
      observed_date_count: observedDates.size,
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
    const result = await geminiImageAnalysisService.analyzeImage({
      imagePayload,
      prompt,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
    });
    return normalizeText(result?.text || '');
  } catch (_e) {
    return '';
  }
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
  majorRescueTextToDataRows
};
