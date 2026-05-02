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
      printDate: { type: 'string' },
      examDateCandidates: { type: 'array', items: { type: 'string' } },
      columnDates: { type: 'array', items: { type: 'string' } },
      exam_dates: { type: 'array', items: { type: 'string' } },
      missing_reason: { type: 'string' },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label_in_image: { type: 'string' },
            normalized_key: { type: 'string' },
            values: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  observedDate: { type: 'string' },
                  value: { type: ['number', 'string'] },
                  unit: { type: 'string' },
                  flag: { type: 'string' },
                  confidence: { type: 'number' },
                  status: { type: 'string' }
                },
                required: ['observedDate', 'value']
              }
            }
          },
          required: ['label_in_image', 'values']
        }
      },
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
    '横に複数の採血日・検査日・測定日・列見出し日付がある表（推移表）では、rows[] を必ず使ってください。',
    'rows[] の各行: label_in_image に項目名、values[] に「その列の実検査日」とセル数値を1セル1要素で入れてください。',
    'values[].observedDate は YYYY-MM-DD。画像に検査日・採血日・列見出しの日付が読めないセルは observedDate に unknown_date のみ（推測で日付を作らない）。',
    'printDate / report_date は印刷・発行日のみ。印刷日を observedDate や検査日候補にコピーしないでください。',
    'examDateCandidates と columnDates には、画像から読み取れた検査日・採血日・列見出しの日付のみを YYYY-MM-DD で列挙（印刷日は含めない）。単日で列見出しに検査日が無ければ空配列でよい。',
    '単日票でも rows を使う場合は values を1件にし、検査日が読めなければ observedDate=unknown_date。',
    'rows と data は併用可。後方互換のため data[] も従来どおり埋めてください（rows が空なら data のみでよい）。',
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
    promptVersion: 'lab_extract_v2',
    schema,
    prompt,
    temperature: 0.05,
    preferredModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  };
}

function buildLabMetaPrompt(meta = {}) {
  const schema = {
    type: 'object',
    properties: {
      patient_name: { type: 'string' },
      patient_name_confidence: { type: 'number' },
      facility_name: { type: 'string' },
      facility_name_confidence: { type: 'number' },
      print_date: { type: 'string' },
      print_date_confidence: { type: 'number' },
      missing_reason: { type: 'string' }
    },
    required: [
      'patient_name',
      'patient_name_confidence',
      'facility_name',
      'facility_name_confidence',
      'print_date',
      'print_date_confidence',
      'missing_reason'
    ]
  };

  const prompt = [
    'あなたは血液検査票のメタ情報抽出担当です。返答はJSONのみ。',
    '抽出対象は patient_name, facility_name, print_date の3項目のみ。',
    '検査項目値(data行)は一切出力しないでください。',
    '各項目について confidence(0-1) を必ず返してください。',
    'print_date は YYYY-MM-DD または空文字。',
    '読めない項目は空文字、confidenceは0、missing_reasonに理由を記載。',
    `補助 document_type: ${meta.documentType || 'unknown'}`,
    `補助 report_date: ${meta.reportDate || ''}`,
  ].join('\n');

  return {
    domain: 'lab_meta',
    promptVersion: 'lab_meta_extract_v1',
    schema,
    prompt,
    temperature: 0,
    preferredModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  };
}

/**
 * 複数日付表（横に日付列、縦に検査項目）専用。matrix セルを data[] に展開する。
 */
function buildLabMatrixExtractSpec(meta = {}) {
  const schema = {
    type: 'object',
    properties: {
      document_type: { type: 'string' },
      exam_dates: { type: 'array', items: { type: 'string' } },
      data: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            normalized_key: { type: 'string' },
            label_in_image: { type: 'string' },
            date: { type: 'string' },
            value: { type: ['string', 'number'] },
            unit: { type: 'string' },
            reference_low: { type: ['number', 'string'] },
            reference_high: { type: ['number', 'string'] },
            flag: { type: 'string' },
            confidence: { type: 'number' },
            status: { type: 'string' },
            row_label_raw: { type: 'string' },
            column_header_raw: { type: 'string' },
            values_by_date: { type: 'object' }
          }
        }
      }
    },
    required: ['document_type', 'data']
  };
  const prompt = [
    'あなたは「多次元の採血結果推移表（同じ用紙に過去採取が横並び）」のOCR/構造化専用です。JSON のみ返してください。',
    'document_type は "multi_date_timeseries" 固定でよいです。',
    '最優先: 左列（または上段左）の検査項目名と、各採血日/検査日列（ヘッダに日付）の交点セルにある数値を1行1セルにした data[] を作ってください。',
    '同一項目が複数日付列に数値を持てば、行を分け、各行に date(YYYY-MM-DD) と value を入れてください。values_by_date オブジェクト { "2024-01-10": "88", "2024-04-10": "92" } も併用可能です（その場合 date は代表の最新でよいが、行は日付分だけ繰り返し推奨）。',
    'normalized_key には ast_got,alt_gpt,gamma_gtp,creatinine,glucose,hba1c,triglycerides_tg,total_cholesterol,hdl_cholesterol,ldl_cholesterol,uric_acid,bun 等を使ってください。不明なら label_in_image だけ必須。value がある行は日付推測のための抜粋元として残す。',
    '採血日/検査日の見出し行の日付を exam_dates に全列挙（正規化 YYYY-MM-DD）。',
    '日付だけ抜かれて数値0件の data は出さない（セル数値必須）。推測で数値を捏造しない。読めないセルは status=unclear。',
    `分類補助 document_type: ${meta.documentType || 'unknown'}`,
    '禁止: 表の枠外の会話、説明文。'
  ].join('\n');
  return {
    domain: 'lab_image_matrix',
    promptVersion: 'lab_matrix_extract_v1',
    schema,
    prompt,
    preferredModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  };
}

module.exports = {
  buildLabExtractPrompt,
  buildLabMetaPrompt,
  buildLabMatrixExtractSpec
};
