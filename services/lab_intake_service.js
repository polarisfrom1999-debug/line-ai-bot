'use strict';

const { genAI, extractGeminiText, retry, safeJsonParse } = require('./gemini_service');
const { getEnv } = require('../config/env');

const env = getEnv();

const LAB_IMAGE_SCHEMA = {
  type: 'object',
  properties: {
    is_lab_report: { type: 'boolean' },
    detected_dates: { type: 'array', items: { type: 'string' } },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          measured_date: { type: 'string' },
          hba1c: { type: 'number' },
          fasting_glucose: { type: 'number' },
          ldl: { type: 'number' },
          hdl: { type: 'number' },
          triglycerides: { type: 'number' },
          ast: { type: 'number' },
          alt: { type: 'number' },
          ggt: { type: 'number' },
          uric_acid: { type: 'number' },
          creatinine: { type: 'number' },
        },
        required: ['measured_date'],
      },
    },
  },
  required: ['is_lab_report'],
};

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return '';
  const m = text.match(/^(\d{2,4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) return '';
  let year = Number(m[1]);
  if (year < 100) year += 2000;
  return `${year.toString().padStart(4, '0')}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

function normalizeLabRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((row) => ({
      measured_date: normalizeDate(row?.measured_date),
      hba1c: toNumberOrNull(row?.hba1c),
      fasting_glucose: toNumberOrNull(row?.fasting_glucose),
      ldl: toNumberOrNull(row?.ldl),
      hdl: toNumberOrNull(row?.hdl),
      triglycerides: toNumberOrNull(row?.triglycerides),
      ast: toNumberOrNull(row?.ast),
      alt: toNumberOrNull(row?.alt),
      ggt: toNumberOrNull(row?.ggt),
      uric_acid: toNumberOrNull(row?.uric_acid),
      creatinine: toNumberOrNull(row?.creatinine),
    }))
    .filter((row) => row.measured_date)
    .filter((row) => Object.values(row).some((v, idx) => idx > 0 && v != null));
}

function buildPrompt() {
  return [
    'あなたは血液検査結果レポートの画像を読み取る補助AIです。',
    '画像が血液検査結果表なら is_lab_report=true にしてください。',
    '横方向に並ぶすべての日付列を読み取り、日付ごとに1行ずつ rows に入れてください。',
    '読み取る対象は HbA1c, 血糖, LDL, HDL, 中性脂肪, AST(GOT), ALT(GPT), γ-GTP, 尿酸, クレアチニン です。',
    '空欄や読めない値は null にしてください。',
    '日付は 2025-03-22 のような ISO 形式に直して返してください。',
    'JSON だけを返してください。',
  ].join('\n');
}

async function analyzeLabImage(buffer, mimeType) {
  const imagePart = {
    inlineData: {
      mimeType,
      data: buffer.toString('base64'),
    },
  };

  const tryModels = [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean);
  let lastError = null;

  for (const model of tryModels) {
    try {
      const response = await retry(async () => genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: buildPrompt() }, imagePart] }],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: LAB_IMAGE_SCHEMA,
          temperature: 0.1,
        },
      }), 2, 800);

      const parsed = safeJsonParse(extractGeminiText(response));
      const rows = normalizeLabRows(parsed?.rows || []);
      return {
        is_lab_report: !!parsed?.is_lab_report,
        detected_dates: (parsed?.detected_dates || []).map(normalizeDate).filter(Boolean),
        rows,
        raw: parsed,
      };
    } catch (error) {
      lastError = error;
      console.error('⚠️ analyzeLabImage failed:', error?.message || error);
    }
  }

  throw lastError || new Error('lab image analysis failed');
}

async function saveLabRows(supabase, userId, rows = [], rawModelJson = null) {
  const normalized = normalizeLabRows(rows);
  if (!normalized.length) return { savedCount: 0 };

  const insertRows = normalized.map((row) => ({
    user_id: userId,
    measured_at: `${row.measured_date}T00:00:00+09:00`,
    hba1c: row.hba1c,
    fasting_glucose: row.fasting_glucose,
    ldl: row.ldl,
    hdl: row.hdl,
    triglycerides: row.triglycerides,
    ast: row.ast,
    alt: row.alt,
    ggt: row.ggt,
    uric_acid: row.uric_acid,
    creatinine: row.creatinine,
    raw_model_json: rawModelJson,
  }));

  for (const row of insertRows) {
    const measuredAt = row.measured_at;
    await supabase.from('lab_results').delete().eq('user_id', userId).eq('measured_at', measuredAt);
  }

  const { error } = await supabase.from('lab_results').insert(insertRows);
  if (error) throw error;
  return { savedCount: insertRows.length };
}

function buildLabSummaryText(result = {}) {
  const rows = normalizeLabRows(result.rows || []);
  if (!rows.length) {
    return '血液検査として見ましたが、表の数値をまだ十分拾い切れていません。もう一度、表全体が入る写真で送ってくださいね。';
  }

  const latest = rows[rows.length - 1];
  const parts = [
    `${rows.length}件ぶんの血液検査を整理しました。`,
    `最新日: ${latest.measured_date}`,
  ];

  if (latest.hba1c != null) parts.push(`HbA1c ${latest.hba1c}`);
  if (latest.ldl != null) parts.push(`LDL ${latest.ldl}`);
  if (latest.hdl != null) parts.push(`HDL ${latest.hdl}`);
  if (latest.triglycerides != null) parts.push(`中性脂肪 ${latest.triglycerides}`);
  return parts.join('\n');
}

module.exports = {
  analyzeLabImage,
  saveLabRows,
  buildLabSummaryText,
  normalizeLabRows,
};
