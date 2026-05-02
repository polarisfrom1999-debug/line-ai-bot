'use strict';

function buildLabExtractPrompt(meta = {}) {
  const examDates = Array.isArray(meta.examDates) ? meta.examDates.filter(Boolean) : [];
  const issues = Array.isArray(meta.issues) ? meta.issues.filter(Boolean) : [];

  // Gemini responseSchema は number|string の union や bbox 等で 400 になり得る。文字列一本化。
  const matrixCellSchema = {
    type: 'object',
    properties: {
      observedDate: { type: 'string' },
      value: { type: 'string' },
      unit: { type: 'string' },
      flag: { type: 'string' },
      confidence: { type: 'number' },
      status: { type: 'string' }
    },
    required: ['observedDate', 'value']
  };

  const rowItemSchema = {
    type: 'object',
    properties: {
      rawName: { type: 'string' },
      label_in_image: { type: 'string' },
      normalized_key: { type: 'string' },
      values: {
        type: 'array',
        items: matrixCellSchema
      }
    },
    required: ['rawName', 'values']
  };

  const dataFallbackItemSchema = {
    type: 'object',
    properties: {
      normalized_key: { type: 'string' },
      label_in_image: { type: 'string' },
      date: { type: 'string' },
      value: { type: 'string' },
      unit: { type: 'string' },
      reference_low: { type: 'string' },
      reference_high: { type: 'string' },
      flag: { type: 'string' },
      confidence: { type: 'number' },
      status: { type: 'string' },
      source_text: { type: 'string' },
      row_label_raw: { type: 'string' },
      column_header_raw: { type: 'string' }
    }
  };

  const schema = {
    type: 'object',
    properties: {
      documentType: { type: 'string' },
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
        items: rowItemSchema
      },
      data: {
        type: 'array',
        items: dataFallbackItemSchema
      },
      issues: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number' }
    },
    required: ['documentType', 'rows']
  };

  const prompt = [
    'あなたは「ここから。」の血液検査表 OCR です。返答は JSON のみ。表を横方向＝採血日・検査日の列、縦方向＝検査項目の matrix として読んでください。',
    '第一正本は rows[] です。各列の見出しにある「検査日・採血日・測定日」を読み取り、その列の数値ごとに values[] に { observedDate, value, unit } を入れてください（列と日付を必ず紐付ける）。',
    '本流（必須）: documentType は "blood_lab_report" 固定。',
    '本流（必須）: rows[] に、各行 rawName＝画像の項目名、values[]＝その項目の各日付列のセルを1要素ずつ入れてください。',
    'values[].observedDate は列見出し・採血日・検査日・測定日から読んだ YYYY-MM-DD。読めない場合のみ "unknown_date"。推測で日付を作らない。',
    'printDate は印刷・発行日のみ。printDate を observedDate や examDateCandidates / columnDates にコピーしないでください。',
    'examDateCandidates と columnDates には、表から読み取れた検査日・採血日・列見出しの日付のみを YYYY-MM-DD で列挙（印刷日は含めない）。単日で列に検査日が無ければ空配列。',
    '保険用 data[]: rows で表現できない場合のみ、従来形式の data[] に label_in_image と value を入れる。rows で表現できているときは data は必ず空配列 []（キーは省略可）。',
    'rows で全セルを表現できているときは data は空配列 [] でよい。',
    '日付だけの疑似行は data に入れない。数値セルが無い行は rows に含めない。',
    '読めないセルは status="unclear"。normalized_key が取れるときは rows に入れてよい（取れなくても rawName があれば可）。',
    `分類済み document_type 補助: ${meta.documentType || 'unknown'}`,
    `分類済み report_date 補助: ${meta.reportDate || 'なし'}`,
    examDates.length ? `分類済み exam_dates 補助: ${examDates.join(', ')}` : '分類済み exam_dates 補助: なし',
    issues.length ? `分類時の注意: ${issues.join(' / ')}` : '分類時の注意: なし',
    '優先 normalized_key: ast_got, alt_gpt, gamma_gtp, creatinine, uric_acid, bun, glucose, hba1c, triglycerides_tg, total_cholesterol, hdl_cholesterol, ldl_cholesterol, ldl_hdl_ratio, sodium, potassium, chloride, egfr, wbc, rbc, hemoglobin, hematocrit, mcv, mch, mchc, platelets, cpk, ldh, total_protein, bilirubin, calcium'
  ].join('\n');

  return {
    domain: 'lab_image',
    promptVersion: 'lab_extract_v3_matrix_primary',
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

/**
 * 初回が data[] のみのときの追い打ち。スキーマに data を置かず rows 強制（API 400 を避ける最小形）。
 */
function buildLabMatrixRetryExtractSpec(meta = {}) {
  const matrixCellSchema = {
    type: 'object',
    properties: {
      observedDate: { type: 'string' },
      value: { type: 'string' },
      unit: { type: 'string' },
      flag: { type: 'string' }
    },
    required: ['observedDate', 'value']
  };
  const rowItemSchema = {
    type: 'object',
    properties: {
      rawName: { type: 'string' },
      normalized_key: { type: 'string' },
      values: { type: 'array', items: matrixCellSchema }
    },
    required: ['rawName', 'values']
  };
  const schema = {
    type: 'object',
    properties: {
      documentType: { type: 'string' },
      printDate: { type: 'string' },
      examDateCandidates: { type: 'array', items: { type: 'string' } },
      columnDates: { type: 'array', items: { type: 'string' } },
      rows: { type: 'array', items: rowItemSchema }
    },
    required: ['documentType', 'rows']
  };
  const prompt = [
    '前回の同じ画像の出力は data[] のフラット列挙でした。今度は必ず matrix として出力してください。JSON のみ。',
    'documentType は "blood_lab_report"。',
    'rows[]: 各検査項目ごとに rawName（画像の日本語名）と values[]。',
    'values[]: その項目の「各日付列」のセルごとに { observedDate, value, unit }。observedDate は列見出しの検査日・採血日・測定日のみ（YYYY-MM-DD）。読めないセルの日付だけ unknown_date。推測で日付を捏造しない。',
    'printDate は印刷日のみ。printDate を observedDate にしない。',
    'examDateCandidates / columnDates に、表の列見出しから読んだ検査日等を列挙（印刷日は含めない）。',
    'このスキーマに data フィールドはありません。フラット列挙は禁止。',
    `分類補助 document_type: ${meta.documentType || 'unknown'}`
  ].join('\n');
  return {
    domain: 'lab_image_matrix_retry',
    promptVersion: 'lab_extract_v3_matrix_retry_rows_only',
    schema,
    prompt,
    temperature: 0.05,
    preferredModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  };
}

module.exports = {
  buildLabExtractPrompt,
  buildLabMetaPrompt,
  buildLabMatrixExtractSpec,
  buildLabMatrixRetryExtractSpec
};
