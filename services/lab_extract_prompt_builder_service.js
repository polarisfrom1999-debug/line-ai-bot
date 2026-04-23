'use strict';

function buildLabExtractPrompt(meta = {}) {
  const examDates = Array.isArray(meta.examDates) ? meta.examDates.filter(Boolean) : [];
  const issues = Array.isArray(meta.issues) ? meta.issues.filter(Boolean) : [];

  const schema = {
    type: 'object',
    properties: {
      document_type: { type: 'string' },
      patient_name: { type: 'string' },
      report_date: { type: 'string' },
      exam_dates: { type: 'array', items: { type: 'string' } },
      missing_reason: { type: 'string' },
      data: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            normalized_key: { type: 'string' },
            label_in_image: { type: 'string' },
            date: { type: 'string' },
            value: { type: ['number', 'string'] },
            unit: { type: 'string' },
            reference_low: { type: ['number', 'string'] },
            reference_high: { type: ['number', 'string'] },
            flag: { type: 'string' },
            confidence: { type: 'number' },
            status: { type: 'string' },
            source_text: { type: 'string' },
            row_label_raw: { type: 'string' },
            column_header_raw: { type: 'string' },
            bbox_value: {
              type: 'array',
              items: { type: 'number' },
              minItems: 4,
              maxItems: 4
            },
            bbox_label: {
              type: 'array',
              items: { type: 'number' },
              minItems: 4,
              maxItems: 4
            }
          }
        }
      },
      issues: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number' }
    },
    required: ['document_type', 'data']
  };

  const prompt = [
    'あなたは「ここから。」の血液検査構造化抽出担当です。返答はJSONのみです。',
    '目的は、単日票または推移表を構造化し、後で保存・照会できるようにすることです。',
    '最重要: data[] を最優先で埋めてください。日付情報だけで返答を終えないでください。',
    '最重要: data の各行は「検査項目 + 値」を表すこと。日付だけの行は data に入れないでください。',
    '最重要: normalized_key が不明でも、label_in_image と value が取れた行は必ず data に残してください。',
    '最重要: document_type が unknown でも、data に項目行があるならそのまま返してください。',
    '最重要: data が空の場合は missing_reason に理由を必ず書いてください（例: value_not_readable / item_labels_not_detected / non_lab_image_like など）。',
    '採血日・検査日の列やラベル付き日付を最優先で読み、各 data 行の date と exam_dates / latest_exam_date に反映してください（印刷日だけで埋めない）。',
    '読めない時は推測せず status="unclear" にしてください。',
    '重要: document_type は single_day_report / multi_date_timeseries / unknown のいずれかにしてください。',
    '重要: normalized_key は既定の正規化キーを優先してください。',
    '重要: 各値には confidence と status を付けてください。',
    '可能なら bbox_value / bbox_label を 0-1000 正規化座標で入れてください。読めないなら省略可です。',
    `分類済み document_type 補助: ${meta.documentType || 'unknown'}`,
    `分類済み report_date 補助: ${meta.reportDate || 'なし'}`,
    examDates.length ? `分類済み exam_dates 補助: ${examDates.join(', ')}` : '分類済み exam_dates 補助: なし',
    issues.length ? `分類時の注意: ${issues.join(' / ')}` : '分類時の注意: なし',
    '優先 normalized_key 一覧: ast_got, alt_gpt, gamma_gtp, creatinine, uric_acid, bun, glucose, hba1c, triglycerides_tg, total_cholesterol, hdl_cholesterol, ldl_cholesterol, ldl_hdl_ratio, sodium, potassium, chloride, egfr, wbc, rbc, hemoglobin, hematocrit, mcv, mch, mchc, platelets, cpk, ldh, total_protein, bilirubin, calcium'
  ].join('\n');

  return {
    domain: 'lab_image',
    promptVersion: 'lab_extract_v1',
    schema,
    prompt,
    temperature: 0.05,
    preferredModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  };
}

module.exports = {
  buildLabExtractPrompt
};
