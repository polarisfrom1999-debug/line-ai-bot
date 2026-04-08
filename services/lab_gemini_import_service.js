'use strict';

/**
 * lab_gemini_import_service.js
 *
 * 血液検査は Gemini を一次取り込み口にする。
 * - Gemini が 1枚 / 複数枚を統合して表と時系列を作る
 * - raw は additive table に保存
 * - thin-normalization では「照会用配列化」へ絞る
 * - 確定保存前は draft として扱い、利用者確認後に panel 化して本流へ載せる
 */

const { runDomainImport } = require('./gemini_import_orchestrator_service');

const KEY_ALIASES = {
  tg: 'triglycerides_tg',
  '中性脂肪': 'triglycerides_tg',
  triglyceride: 'triglycerides_tg',
  hba1c: 'hba1c',
  'ヘモグロビンa1c': 'hba1c',
  ldl: 'ldl_cholesterol',
  'ldlコレステロール': 'ldl_cholesterol',
  hdl: 'hdl_cholesterol',
  'hdlコレステロール': 'hdl_cholesterol',
  'ast(got)': 'ast_got',
  ast: 'ast_got',
  got: 'ast_got',
  'alt(gpt)': 'alt_gpt',
  alt: 'alt_gpt',
  gpt: 'alt_gpt',
  cpk: 'cpk',
  ck: 'cpk',
  egfr: 'egfr',
  cre: 'creatinine',
  'クレアチニン': 'creatinine',
  '総コレステロール': 'total_cholesterol',
  't-cho': 'total_cholesterol',
  cho: 'total_cholesterol',
};

const DISPLAY_LABELS = {
  triglycerides_tg: '中性脂肪',
  hba1c: 'HbA1c',
  ldl_cholesterol: 'LDL',
  hdl_cholesterol: 'HDL',
  total_cholesterol: '総コレステロール',
  ast_got: 'AST',
  alt_gpt: 'ALT',
  cpk: 'CPK',
  egfr: 'eGFR',
  creatinine: 'クレアチニン',
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  const safe = normalizeText(value).toLowerCase();
  return KEY_ALIASES[safe] || safe;
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
  return safe;
}

function sortDatesAsc(values = []) {
  return [...new Set((values || []).map(normalizeDateToken).filter(Boolean))].sort();
}

function pickDisplayLabel(normalizedKey, fallbackLabel = '') {
  return DISPLAY_LABELS[normalizedKey] || normalizeText(fallbackLabel) || normalizedKey;
}

const promptBuilder = {
  async build({ attachments }) {
    return {
      schemaName: 'lab_import_v1',
      promptVersion: 'lab_import_v2_confirmable',
      prompt: [
        'あなたは血液検査画像の構造化担当です。',
        '複数画像が来たら同じ検査回として統合してください。',
        '必ず JSON だけを返してください。',
        '読めた値は推測で埋めず、読めない所は issues に理由を書いてください。',
        '返すべき最上位キー:',
        '{',
        '  "document_type": "single_day_report | multi_date_timeseries | unknown",',
        '  "session_summary": "...",',
        '  "tables": [',
        '    {',
        '      "dates": ["YYYY-MM-DD"],',
        '      "rows": [',
        '        {',
        '          "label": "TG",',
        '          "unit": "mg/dL",',
        '          "values_by_date": {"2025-03-22": 61}',
        '        }',
        '      ]',
        '    }',
        '  ],',
        '  "issues": [],',
        '  "confidence": 0.0',
        '}',
        `画像数: ${attachments.length}`,
      ].join('\n'),
    };
  },
};

const thinNormalizer = {
  async normalize({ raw }) {
    const tables = Array.isArray(raw?.tables) ? raw.tables : [];
    const measurements = [];

    for (const table of tables) {
      const rows = Array.isArray(table?.rows) ? table.rows : [];
      for (const row of rows) {
        const label = normalizeText(row?.label || '');
        const normalizedKey = normalizeKey(label);
        const valuesByDate = row?.values_by_date || {};
        for (const [date, value] of Object.entries(valuesByDate)) {
          if (value === null || value === undefined || value === '') continue;
          measurements.push({
            date: normalizeDateToken(date),
            label: pickDisplayLabel(normalizedKey, label),
            normalized_key: normalizedKey,
            unit: normalizeText(row?.unit || '') || null,
            value,
          });
        }
      }
    }

    const rawDates = [];
    for (const table of tables) {
      const dates = Array.isArray(table?.dates) ? table.dates.map(normalizeDateToken).filter(Boolean) : [];
      rawDates.push(...dates);
    }

    return {
      summary: raw?.session_summary || null,
      document_type: raw?.document_type || 'unknown',
      confidence: raw?.confidence ?? null,
      issues: Array.isArray(raw?.issues) ? raw.issues : [],
      exam_dates: sortDatesAsc(rawDates),
      measurements,
    };
  },
};

function buildLabPanelFromNormalized(normalized = {}) {
  const measurements = Array.isArray(normalized?.measurements) ? normalized.measurements : [];
  const examDates = sortDatesAsc([...(normalized?.exam_dates || []), ...measurements.map((row) => row?.date)]);
  const latestExamDate = examDates[examDates.length - 1] || '';
  const itemsByKey = new Map();

  for (const measurement of measurements) {
    const key = normalizeKey(measurement?.normalized_key || measurement?.label || '');
    if (!key) continue;
    if (!itemsByKey.has(key)) {
      itemsByKey.set(key, {
        itemName: pickDisplayLabel(key, measurement?.label || ''),
        value: '',
        unit: normalizeText(measurement?.unit || ''),
        flag: '',
        history: [],
      });
    }
    const item = itemsByKey.get(key);
    const row = {
      date: normalizeDateToken(measurement?.date || ''),
      value: normalizeText(measurement?.value),
      unit: normalizeText(measurement?.unit || item.unit),
      flag: normalizeText(measurement?.flag || ''),
    };
    if (row.date && row.value) item.history.push(row);
    if (row.unit && !item.unit) item.unit = row.unit;
  }

  const items = [...itemsByKey.values()]
    .map((item) => {
      item.history = item.history.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      const latestRow = item.history.find((row) => row.date === latestExamDate) || item.history[item.history.length - 1] || null;
      if (latestRow) {
        item.value = latestRow.value;
        item.unit = latestRow.unit || item.unit || '';
        item.flag = latestRow.flag || '';
      }
      return item;
    })
    .filter((item) => item.itemName && (item.value || item.history.length));

  const hasSignal = items.length > 0 || examDates.length > 0 || normalizeText(normalized?.summary || '') || normalizeText(normalized?.document_type || '') !== 'unknown' || (Array.isArray(normalized?.issues) && normalized.issues.length);

  return {
    source: 'gemini_import',
    isLabImage: Boolean(hasSignal),
    labLike: Boolean(hasSignal),
    reportDate: latestExamDate,
    examDate: latestExamDate,
    latestExamDate,
    examDates,
    availableDates: examDates,
    documentKind: normalized?.document_type || (examDates.length >= 2 ? 'multi_date_timeseries' : 'single_day_report'),
    patientName: '',
    items,
    structuredRows: [],
    issues: Array.isArray(normalized?.issues) ? normalized.issues : [],
    confidence: Number(normalized?.confidence || 0) || 0,
    trendSummary: normalized?.summary || '',
    rawText: '',
    labPending: true,
  };
}

async function importLabWithGemini({ userId, attachments, geminiRunner, store, sessionMeta }) {
  return runDomainImport({
    userId,
    domain: 'lab',
    attachments,
    promptBuilder,
    geminiRunner,
    store,
    thinNormalizer,
    sessionMeta,
  });
}

module.exports = {
  importLabWithGemini,
  buildLabPanelFromNormalized,
  sortDatesAsc,
};
