'use strict';

/**
 * lab_gemini_import_service.js
 *
 * 血液検査は Gemini を一次取り込み口にする。
 * - Gemini が 1枚 / 複数枚を統合して表と時系列を作る
 * - そのまま raw 保存
 * - thin-normalization では「項目名整理」と「照会用配列化」だけ行う
 */

const { runDomainImport } = require('./gemini_import_orchestrator_service');

const KEY_ALIASES = {
  'tg': 'triglycerides_tg',
  '中性脂肪': 'triglycerides_tg',
  'hba1c': 'hba1c',
  'ldl': 'ldl_cholesterol',
  'ldlコレステロール': 'ldl_cholesterol',
  'hdl': 'hdl_cholesterol',
  'hdlコレステロール': 'hdl_cholesterol',
  'ast(got)': 'ast_got',
  'ast': 'ast_got',
  'got': 'ast_got',
  'alt(gpt)': 'alt_gpt',
  'alt': 'alt_gpt',
  'gpt': 'alt_gpt',
  'cpk': 'cpk',
};

const promptBuilder = {
  async build({ attachments }) {
    return {
      schemaName: 'lab_import_v1',
      promptVersion: 'lab_import_v1',
      prompt: [
        'あなたは血液検査画像の構造化担当です。',
        '複数画像が来たら同じ検査回として統合してください。',
        '必ず JSON だけを返してください。',
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
        const label = String(row?.label || '').trim();
        const normalizedKey = KEY_ALIASES[label.toLowerCase()] || label;
        const valuesByDate = row?.values_by_date || {};
        for (const [date, value] of Object.entries(valuesByDate)) {
          if (value === null || value === undefined || value === '') continue;
          measurements.push({
            date,
            label,
            normalized_key: normalizedKey,
            unit: row?.unit || null,
            value,
          });
        }
      }
    }

    return {
      summary: raw?.session_summary || null,
      document_type: raw?.document_type || 'unknown',
      confidence: raw?.confidence ?? null,
      issues: Array.isArray(raw?.issues) ? raw.issues : [],
      measurements,
    };
  },
};

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
};
