'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const classifier = require('./lab_document_classifier_service');
const geminiDispatchService = require('./gemini_dispatch_service');
const { buildLabExtractPrompt } = require('./lab_extract_prompt_builder_service');
const labMatrixExtractService = require('./lab_matrix_extract_service');
const phaseeReachabilityService = require('./phasee_reachability_service');
const labIngestTrace = require('./lab_ingest_trace_service');
const { KEY_TO_ITEM_NAME } = require('./lab_lab_display_names');
const geminiItems = require('./lab_gemini_items_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizeGeminiText(text) {
  return classifier.sanitizeGeminiText(text);
}

function extractJson(text) {
  const safe = sanitizeGeminiText(text);
  if (!safe) return null;
  try {
    return JSON.parse(safe);
  } catch (_error) {
    return classifier.extractJsonObject(safe);
  }
}

function getRawCandidateText(raw) {
  const candidates = Array.isArray(raw?.candidates) ? raw.candidates : [];
  const first = candidates[0];
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
  const text = parts.map((p) => normalizeText(p?.text || '')).join('\n').trim();
  return text;
}

function rescueRowsFromRawText(text) {
  const safe = normalizeText(text);
  if (!safe) return [];
  const rows = [];
  const re = /"(?:label_in_image|item|検査項目)"\s*:\s*"([^"]+)"[\s\S]{0,260}?"normalized_key"\s*:\s*"([^"]*)"[\s\S]{0,260}?"value"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(safe)) !== null) {
    const label = normalizeText(m[1]);
    const key = normalizeText(m[2]);
    const value = normalizeText(m[3]);
    if (!label || !value) continue;
    if (classifier.normalizeDateToken(value)) continue;
    rows.push({
      label_in_image: label,
      normalized_key: key,
      value,
      confidence: 0.5,
      status: 'rescued_from_raw'
    });
  }
  if (rows.length) return rows;
  const reLoose = /"(?:label_in_image|item|検査項目)"\s*:\s*"([^"]+)"[\s\S]{0,260}?"value"\s*:\s*"([^"]+)"/g;
  while ((m = reLoose.exec(safe)) !== null) {
    const label = normalizeText(m[1]);
    const value = normalizeText(m[2]);
    if (!label || !value) continue;
    if (classifier.normalizeDateToken(value)) continue;
    rows.push({
      label_in_image: label,
      normalized_key: '',
      value,
      confidence: 0.4,
      status: 'rescued_from_raw'
    });
  }
  return rows;
}

function buildTextRescuePrompt(meta = {}) {
  const hintDate = normalizeText(meta?.latestExamDate || meta?.reportDate || '');
  return [
    'あなたは血液検査票のOCR補助です。項目名と数値だけを抽出してください。',
    '出力はプレーンテキスト。1行1項目で「項目名: 値 単位」形式にしてください。',
    '日付のみの行、検査日だけの情報、罫線情報、bbox情報は出力しないでください。',
    'TG/中性脂肪, HbA1c, Hb/血色素量, AST, ALT, LDL, HDL, 血糖, Cr を優先してください。',
    hintDate ? `補助日付: ${hintDate}` : '補助日付: なし',
  ].join('\n');
}

function rescueRowsFromNarrativeText(text) {
  const safe = normalizeText(text);
  if (!safe) return [];
  const out = [];
  const seen = new Set();
  const lines = safe.split(/\r?\n/).map((l) => normalizeText(l)).filter(Boolean);
  const lineRegex = /^(?:[-*・]\s*)?([^:：|]+?)\s*[:：|]\s*([^\s]+)(?:\s+([^\s]+))?/;
  for (const line of lines) {
    const m = line.match(lineRegex);
    if (!m) continue;
    const label = normalizeText(m[1]);
    const rawValue = normalizeText(m[2]);
    const unit = normalizeUnit(m[3] || '');
    if (!label || !rawValue) continue;
    if (classifier.normalizeDateToken(rawValue)) continue;
    const numeric = numberFromSourceText(rawValue);
    if (numeric == null) continue;
    const normalizedKey = normalizeKey('', label);
    const dedupe = `${normalizedKey || label}:${numeric}:${unit}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      label_in_image: label,
      normalized_key: normalizedKey,
      value: String(numeric),
      unit,
      confidence: 0.45,
      status: 'rescued_from_text'
    });
  }
  return out;
}

function coerceStructuredPayloadShape(payload, rawText, rawCandidateText, meta = {}) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const obj = { ...payload };
    if (!Array.isArray(obj.data)) obj.data = [];
    if (!obj.document_type && meta?.documentType) obj.document_type = meta.documentType;
    return obj;
  }
  const rescuedRows = rescueRowsFromRawText(`${rawCandidateText || ''}\n${rawText || ''}`);
  if (Array.isArray(payload)) {
    const arrRows = payload
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({
        label_in_image: normalizeText(x.label_in_image || x.row_label_raw || ''),
        normalized_key: normalizeText(x.normalized_key || ''),
        value: normalizeText(x.value || ''),
        confidence: Number(x.confidence || 0) || 0,
        status: normalizeText(x.status || 'present')
      }))
      .filter((x) => x.value && !classifier.normalizeDateToken(x.value) && (x.label_in_image || x.normalized_key));
    const data = arrRows.length ? arrRows : rescuedRows;
    return {
      document_type: normalizeText(meta?.documentType || 'unknown'),
      missing_reason: data.length ? '' : 'data_array_missing_or_date_only',
      data
    };
  }
  return {
    document_type: normalizeText(meta?.documentType || 'unknown'),
    missing_reason: rescuedRows.length ? '' : 'payload_not_object',
    data: rescuedRows
  };
}

function buildRescueExtractionSpec(meta = {}) {
  const hintDate = normalizeText(meta?.latestExamDate || meta?.reportDate || '');
  return {
    prompt: [
      '血液検査画像から「項目名と数値」だけを優先抽出してください。JSONのみ返してください。',
      '最重要: data[] に数値付きの検査項目を入れてください。日付だけは入れないでください。',
      'normalized_key が不明でも label_in_image と value があれば入れてください。',
      '優先項目: triglycerides_tg, hba1c, hemoglobin, total_protein, glucose, creatinine, ast_got, alt_gpt',
      hintDate ? `補助日付: ${hintDate}` : '補助日付: なし'
    ].join('\n'),
    schema: {
      type: 'object',
      properties: {
        document_type: { type: 'string' },
        missing_reason: { type: 'string' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              normalized_key: { type: 'string' },
              label_in_image: { type: 'string' },
              value: { type: ['string', 'number'] },
              unit: { type: 'string' },
              confidence: { type: 'number' },
              status: { type: 'string' }
            }
          }
        }
      },
      required: ['data']
    }
  };
}

function normalizeNumberText(value) {
  const safe = normalizeText(value);
  if (!safe) return '';
  const extracted = safe.replace(/[^\d.\-]/g, '');
  if (!extracted || extracted === '.' || extracted === '-' || extracted === '-.') return '';
  return extracted;
}

function normalizeMaybeNumber(value) {
  const safe = normalizeNumberText(value);
  return safe ? Number(safe) : null;
}

function numberFromSourceText(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  const m = safe.match(/-?\d+(?:\.\d+)?/);
  return m ? normalizeMaybeNumber(m[0]) : null;
}

function normalizeStatus(value) {
  const safe = normalizeText(value).toLowerCase();
  if (!safe) return 'unknown';
  if (safe.includes('read')) return 'readable';
  if (safe.includes('unclear')) return 'unclear';
  if (safe.includes('missing')) return 'missing';
  if (safe.includes('not_present')) return 'not_present';
  return 'unknown';
}

function normalizeFlag(value, numericValue, low, high) {
  const safe = normalizeText(value).toLowerCase();
  if (safe === 'h' || safe === 'high') return 'H';
  if (safe === 'l' || safe === 'low') return 'L';
  if (safe === 'normal') return '';
  if (numericValue != null && low != null && numericValue < low) return 'L';
  if (numericValue != null && high != null && numericValue > high) return 'H';
  return '';
}

function normalizeUnit(value) {
  return normalizeText(value)
    .replace(/ｍｇ\/ｄＬ/gi, 'mg/dL')
    .replace(/ｍｇ\/ｄｌ/gi, 'mg/dL')
    .replace(/％/g, '%')
    .replace(/μ/g, 'u');
}

function extractDateTokensFromText(value) {
  const safe = normalizeText(value);
  if (!safe) return [];
  const out = [];
  const re = /(20\d{2}[\/\.\-年]\s*\d{1,2}[\/\.\-月]\s*\d{1,2}日?)/g;
  let m;
  while ((m = re.exec(safe)) !== null) {
    const d = classifier.normalizeDateToken(m[1]);
    if (d) out.push(d);
  }
  return classifier.uniqueSortedDates(out);
}

function inferObservedDate(row = {}, defaultDate = '') {
  const direct = classifier.normalizeDateToken(
    row?.date
    || row?.observed_date
    || row?.observedDate
    || row?.exam_date
    || row?.examDate
    || ''
  );
  if (direct) return direct;
  const headerDate = classifier.normalizeDateToken(row?.column_header_raw || row?.columnHeaderRaw || '');
  if (headerDate) return headerDate;
  const fromSource = extractDateTokensFromText(`${normalizeText(row?.source_text || row?.sourceText || '')} ${normalizeText(row?.value || '')}`);
  return fromSource[fromSource.length - 1] || classifier.normalizeDateToken(defaultDate);
}

function normalizeKey(key, label) {
  const safeKey = normalizeText(key).toLowerCase();
  if (KEY_TO_ITEM_NAME[safeKey]) return safeKey;
  const safeLabel = normalizeText(label).toLowerCase();
  if (/^got|ast/.test(safeLabel) || safeLabel.includes('ast')) return 'ast_got';
  if (/^gpt|alt/.test(safeLabel) || safeLabel.includes('alt')) return 'alt_gpt';
  if (safeLabel.includes('γ') || safeLabel.includes('gtp')) return 'gamma_gtp';
  if (safeLabel.includes('中性脂肪') || safeLabel.includes('tg') || safeLabel.includes('トリグリ')) return 'triglycerides_tg';
  if (safeLabel.includes('ldl/hdl')) return 'ldl_hdl_ratio';
  if (safeLabel.includes('ldl')) return 'ldl_cholesterol';
  if (safeLabel.includes('hdl')) return 'hdl_cholesterol';
  if (safeLabel.includes('総コレステ')) return 'total_cholesterol';
  if (safeLabel.includes('hba1c')) return 'hba1c';
  if (safeLabel.includes('クレアチニン') || safeLabel === 'cre') return 'creatinine';
  if (safeLabel.includes('egfr')) return 'egfr';
  if (safeLabel.includes('尿酸')) return 'uric_acid';
  if (safeLabel.includes('尿素窒素') || safeLabel === 'bun') return 'bun';
  if (safeLabel.includes('血糖') || safeLabel.includes('glucose')) return 'glucose';
  if (safeLabel.includes('白血球')) return 'wbc';
  if (safeLabel.includes('赤血球')) return 'rbc';
  if (safeLabel.includes('血色素')) return 'hemoglobin';
  if (safeLabel.includes('ヘマト')) return 'hematocrit';
  if (safeLabel === 'mcv') return 'mcv';
  if (safeLabel === 'mch') return 'mch';
  if (safeLabel === 'mchc') return 'mchc';
  if (safeLabel.includes('血小板')) return 'platelets';
  if (safeLabel === 'na' || safeLabel.includes('ナトリウム')) return 'sodium';
  if (safeLabel === 'k' || safeLabel.includes('カリウム')) return 'potassium';
  if (safeLabel === 'cl' || safeLabel.includes('クロール')) return 'chloride';
  if (safeLabel === 'cpk') return 'cpk';
  if (safeLabel === 'ldh') return 'ldh';
  if (safeLabel.includes('総蛋白')) return 'total_protein';
  if (safeLabel.includes('ビリルビン')) return 'bilirubin';
  if (safeLabel === 'ca') return 'calcium';
  return '';
}

function uniqueSortedDates(values) {
  return classifier.uniqueSortedDates(values);
}

function flattenReports(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.extracted_reports)) return payload.extracted_reports;
  if (Array.isArray(payload.reports)) return payload.reports;
  if (Array.isArray(payload.data) || payload.document_type || payload.documentType) return [payload];
  return [];
}

function normalizeRows(report) {
  const defaultDate = classifier.normalizeDateToken(report?.latest_exam_date || report?.latestExamDate || report?.report_date || report?.reportDate || '');
  const rows = [];
  for (const row of Array.isArray(report?.data) ? report.data : []) {
    const labelIn = normalizeText(row?.label_in_image || row?.labelInImage || row?.row_label_raw || row?.rowLabelRaw || '');
    let normalizedKey = normalizeKey(row?.normalized_key || row?.normalizedKey, labelIn);
    if (!normalizedKey && labelIn) normalizedKey = normalizeKey('', labelIn);
    if (!normalizedKey) continue;
    const itemName = KEY_TO_ITEM_NAME[normalizedKey] || labelIn || normalizedKey;
    const date = inferObservedDate(row, defaultDate || '');
    const numericValue = normalizeMaybeNumber(row?.value) ?? numberFromSourceText(row?.source_text || row?.sourceText || '');
    const multiDateValues = row?.values_by_date && typeof row.values_by_date === 'object' && !Array.isArray(row.values_by_date) ? row.values_by_date : null;
    if (multiDateValues) {
      for (const [k, v] of Object.entries(multiDateValues)) {
        const nd = classifier.normalizeDateToken(k);
        const nv = normalizeMaybeNumber(v) ?? numberFromSourceText(v);
        if (!nd || nv == null) continue;
        const referenceLow = normalizeMaybeNumber(row?.reference_low ?? row?.referenceLow);
        const referenceHigh = normalizeMaybeNumber(row?.reference_high ?? row?.referenceHigh);
        rows.push({
          normalizedKey,
          itemName,
          labelInImage: normalizeText(row?.label_in_image || row?.labelInImage || itemName),
          date: nd,
          value: String(nv),
          unit: normalizeUnit(row?.unit || ''),
          referenceLow,
          referenceHigh,
          flag: normalizeFlag(row?.flag, nv, referenceLow, referenceHigh),
          confidence: Number(row?.confidence || 0) || 0,
          status: normalizeStatus(row?.status || 'readable'),
          sourceText: normalizeText(row?.source_text || row?.sourceText || row?.value || ''),
          rowLabelRaw: normalizeText(row?.row_label_raw || row?.rowLabelRaw || row?.label_in_image || row?.labelInImage || ''),
          columnHeaderRaw: normalizeText(row?.column_header_raw || row?.columnHeaderRaw || k)
        });
      }
      continue;
    }
    if (numericValue == null) continue;
    const referenceLow = normalizeMaybeNumber(row?.reference_low ?? row?.referenceLow);
    const referenceHigh = normalizeMaybeNumber(row?.reference_high ?? row?.referenceHigh);
    rows.push({
      normalizedKey,
      itemName,
      labelInImage: normalizeText(row?.label_in_image || row?.labelInImage || itemName),
      date,
      value: String(numericValue),
      unit: normalizeUnit(row?.unit || ''),
      referenceLow,
      referenceHigh,
      flag: normalizeFlag(row?.flag, numericValue, referenceLow, referenceHigh),
      confidence: Number(row?.confidence || 0) || 0,
      status: normalizeStatus(row?.status || 'readable'),
      sourceText: normalizeText(row?.source_text || row?.sourceText || row?.value || ''),
      rowLabelRaw: normalizeText(row?.row_label_raw || row?.rowLabelRaw || row?.label_in_image || row?.labelInImage || ''),
      columnHeaderRaw: normalizeText(row?.column_header_raw || row?.columnHeaderRaw || row?.date || '')
    });
  }
  return rows;
}

function groupRowsToItems(rows, latestExamDate) {
  const map = new Map();
  for (const row of rows) {
    const key = row.itemName;
    const current = map.get(key) || { itemName: key, unit: row.unit, flag: '', value: '', history: [], references: {} };
    current.unit = row.unit || current.unit;
    current.history.push({
      date: row.date,
      value: row.value,
      unit: row.unit,
      flag: row.flag,
      referenceLow: row.referenceLow,
      referenceHigh: row.referenceHigh,
      confidence: row.confidence,
      status: row.status,
      sourceText: row.sourceText,
      rowLabelRaw: row.rowLabelRaw,
      columnHeaderRaw: row.columnHeaderRaw
    });
    map.set(key, current);
  }

  const out = [];
  for (const item of map.values()) {
    const history = item.history
      .filter((row) => row.date && row.value)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const deduped = [];
    const seen = new Set();
    for (const row of history) {
      const dedupeKey = `${row.date}:${row.value}:${row.unit}:${row.flag}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      deduped.push(row);
    }
    const undated = item.history.filter((row) => !row.date && row.value);
    const latestUndated = undated[undated.length - 1] || null;
    const latest = deduped.find((row) => row.date === latestExamDate) || deduped[deduped.length - 1] || latestUndated || null;
    out.push({
      itemName: item.itemName,
      unit: latest?.unit || item.unit || '',
      value: latest?.value || '',
      flag: latest?.flag || '',
      referenceLow: latest?.referenceLow ?? null,
      referenceHigh: latest?.referenceHigh ?? null,
      history: deduped
    });
  }

  return out.sort((a, b) => a.itemName.localeCompare(b.itemName, 'ja'));
}

async function extractStructuredLab(imagePayload, meta = {}) {
  const builder = buildLabExtractPrompt(meta);
  console.info('[lab-ingest-trace] stage:extract_prompt_info', {
    userId: meta.userId,
    prompt_version: builder?.promptVersion || '',
    domain: builder?.domain || '',
    preferred_model: builder?.preferredModel || ''
  });
  let payload = {};
  let rawText = '';
  let ok = false;
  let geminiTraceBundle = null;
  let rawCandidateText = '';
  let textRescueRowCount = 0;
  let matrixRowsCount = 0;
  let matrixRescueRowsCount = 0;

  try {
    const dispatch = await geminiDispatchService.generateStructuredImageJson({
      imagePayload,
      prompt: builder.prompt,
      schema: builder.schema,
      domain: builder.domain,
      model: builder.preferredModel,
      temperature: builder.temperature,
      maxOutputTokens: 3200
    });
    if (!dispatch?.ok) {
      throw new Error(dispatch?.error?.message || 'structured_image_dispatch_failed');
    }
    ok = true;
    payload = dispatch?.json || {};
    rawCandidateText = getRawCandidateText(dispatch?.raw);
    rawText = sanitizeGeminiText(dispatch?.text || JSON.stringify(dispatch?.json || {}));
    geminiTraceBundle = {
      path: 'structured_image_json',
      ok: true,
      model: dispatch?.model,
      text: dispatch?.text,
      parsed_json: dispatch?.json,
      raw: dispatch?.raw
    };
  } catch (dispatchError) {
    console.info('[phasee-old] old_local_parser_reached', {
      userId: normalizeText(meta?.userId || ''),
      reason: 'structured_dispatch_failed'
    });
    phaseeReachabilityService.recordReachability('old_local_parser_reached', ['services/lab_structured_extract_service.js'], {
      userId: normalizeText(meta?.userId || ''),
      reason: 'structured_dispatch_failed'
    }).catch(() => null);
    console.error('[lab_structured_extract_service] builder dispatch failed:', dispatchError?.message || dispatchError);
    const result = await geminiImageAnalysisService.analyzeImage({
      imagePayload,
      prompt: builder.prompt,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
    });
    ok = Boolean(result?.ok);
    rawText = sanitizeGeminiText(result?.text || '');
    payload = extractJson(result?.text || '') || {};
    geminiTraceBundle = {
      path: 'fallback_text_parse',
      image_ok: result?.ok,
      data: result?.data,
      text: result?.text
    };
  }

  payload = coerceStructuredPayloadShape(payload, rawText, rawCandidateText, meta);
  const initialPrimary = geminiItems.extractPrimaryGeminiMinItems(payload);
  if (!initialPrimary.length) {
    try {
      const rescueSpec = buildRescueExtractionSpec(meta);
      const rescue = await geminiDispatchService.generateStructuredImageJson({
        imagePayload,
        prompt: rescueSpec.prompt,
        schema: rescueSpec.schema,
        domain: 'lab_image_rescue',
        model: builder.preferredModel,
        temperature: 0,
        maxOutputTokens: 900
      });
      if (rescue?.ok) {
        const rescuePayload = coerceStructuredPayloadShape(rescue?.json || {}, sanitizeGeminiText(rescue?.text || ''), getRawCandidateText(rescue?.raw), meta);
        const rescuePrimary = geminiItems.extractPrimaryGeminiMinItems(rescuePayload);
        if (rescuePrimary.length) {
          payload = {
            ...rescuePayload,
            document_type: normalizeText(rescuePayload.document_type || payload.document_type || meta.documentType || 'unknown'),
            data: Array.isArray(rescuePayload.data) ? rescuePayload.data : [],
            missing_reason: normalizeText(rescuePayload.missing_reason || '')
          };
          rawText = sanitizeGeminiText(rescue?.text || rawText);
          if (geminiTraceBundle && typeof geminiTraceBundle === 'object') {
            geminiTraceBundle.rescue = {
              ok: true,
              model: rescue?.model || '',
              parsed_json: rescue?.json || {},
              text: rescue?.text || ''
            };
          }
        }
      }
    } catch (_err) {
      // noop: keep first-pass payload
    }
  }
  const postRescuePrimary = geminiItems.extractPrimaryGeminiMinItems(payload);
  if (!postRescuePrimary.length) {
    try {
      const textRescue = await geminiImageAnalysisService.analyzeImage({
        imagePayload,
        prompt: buildTextRescuePrompt(meta),
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
      });
      const textRows = rescueRowsFromNarrativeText(textRescue?.text || '');
      if (textRows.length) {
        textRescueRowCount = textRows.length;
        payload = {
          ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
          document_type: normalizeText((payload && payload.document_type) || meta.documentType || 'blood_test'),
          missing_reason: '',
          data: textRows
        };
        rawText = sanitizeGeminiText(textRescue?.text || rawText);
        if (geminiTraceBundle && typeof geminiTraceBundle === 'object') {
          geminiTraceBundle.text_rescue = {
            ok: Boolean(textRescue?.ok),
            model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
            text: textRescue?.text || '',
            rows: textRows.length
          };
        }
      }
    } catch (_err) {
      // noop
    }
  }

  const layoutClassifier = classifier.normalizeDocumentType(meta.documentType || payload?.document_type || '');
  const layoutLabel = layoutClassifier === 'multi_date_timeseries' ? 'lab_multi_date_matrix' : 'lab_single_day_report';
  console.info('[phasee-new] lab_document_layout_type', { userId: meta.userId || '', layout: layoutLabel, classifier_doc: layoutClassifier });

  const isChatLayout = /chat|screenshot/i.test(String(meta?.documentType || ''));
  const afterAllRescuesPrimary = geminiItems.extractPrimaryGeminiMinItems(payload);
  const observedInPrimary = afterAllRescuesPrimary.filter((x) => normalizeText(x?.observedDate || x?.observed_date)).length;
  const rawDateHintCount = extractDateTokensFromText(rawText || '').length;
  const payloadDateHintCount = extractDateTokensFromText(JSON.stringify(payload || {})).length;
  const matrixHintLikely = /multi[_\s-]?date|時系列|検査日|採血日|前回|今回/i.test(String(layoutClassifier || '') + ' ' + String(rawText || ''));
  const matrixByDateGap = afterAllRescuesPrimary.length > 0
    && observedInPrimary === 0
    && (rawDateHintCount >= 2 || payloadDateHintCount >= 2 || matrixHintLikely || afterAllRescuesPrimary.length >= 8);
  const runMatrix = !isChatLayout && (layoutClassifier === 'multi_date_timeseries' || !afterAllRescuesPrimary.length || matrixByDateGap);
  if (runMatrix) {
    const m1 = await labMatrixExtractService.extractMatrixTable(imagePayload, { ...meta, userId: meta.userId });
    const m1Rows = Array.isArray(m1?.data) ? m1.data : [];
    matrixRowsCount = m1Rows.length;
    const m1Diag = m1Rows.length ? labMatrixExtractService.buildMatrixDiagnostics(m1Rows) : null;
    const needRescue = !m1Rows.length
      || !m1Diag
      || m1Diag.headersDistinct.length < 2
      || m1Diag.mappings.length < 1;
    if (!needRescue) {
      const existing = Array.isArray(payload.data) ? payload.data : [];
      payload = {
        ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
        document_type: 'multi_date_timeseries',
        data: [...existing, ...m1Rows]
      };
    } else {
      const txt = await labMatrixExtractService.extractMatrixMajorRescueText(imagePayload, meta);
      let extra = labMatrixExtractService.majorRescueTextToDataRows(txt);
      const extraDates = new Set(extra.map((x) => normalizeText(x?.date || x?.observedDate || x?.observed_date || '')).filter(Boolean));
      if (!extra.length || extraDates.size < 2) {
        const tsv = await labMatrixExtractService.extractMatrixRescueTsvText(imagePayload);
        const tsvRows = labMatrixExtractService.parseTsvRowsToDataRows(tsv);
        if (tsvRows.length) extra = tsvRows;
      }
      if (extra.length) {
        matrixRescueRowsCount = extra.length;
        extra = extra.map((r) => {
          const nk = normalizeText(r?.normalized_key || r?.normalizedKey || '');
          if (nk) return r;
          const raw = normalizeText(r?.label_in_image || r?.rawName || r?.name || '');
          if (!raw) return r;
          return { ...r, normalized_key: `raw_label:${raw.toLowerCase()}` };
        });
      }
      if (extra.length) {
        const extraDiag = labMatrixExtractService.buildMatrixDiagnostics(extra);
        console.info('[phasee-new] lab_matrix_header_extract', {
          userId: meta.userId || '',
          date_header_candidates: extra.length,
          observed_date_count: extraDiag.headersDistinct.length,
          observed_dates: extraDiag.headersDistinct,
          rejected_headers: extraDiag.headerRejected.slice(0, 20),
          reason: extraDiag.reason || ''
        });
        console.info('[phasee-new] lab_matrix_row_label_extract', {
          userId: meta.userId || '',
          row_label_candidates: extra.length,
          normalized_key_count: extraDiag.rowCandidates.length,
          major_key_count: extraDiag.majorCount,
          raw_row_labels_sample: extra.slice(0, 5).map((r) => normalizeText(r?.label_in_image || r?.rawName || r?.name || '')),
          rejected_row_labels: extraDiag.rowRejected.slice(0, 20),
          reason: extraDiag.reason || ''
        });
        console.info('[phasee-new] lab_matrix_cell_value_extract', {
          userId: meta.userId || '',
          numeric_cell_count: extraDiag.cellCandidates.length,
          numeric_cells_sample: extraDiag.cellCandidates.slice(0, 8),
          units_found: extraDiag.unitsFound,
          flags_found: extraDiag.flagsFound,
          rejected_cells: extraDiag.cellRejected.slice(0, 20),
          reason: extraDiag.reason || ''
        });
        console.info('[phasee-new] lab_matrix_mapping', {
          userId: meta.userId || '',
          mapping_count: extraDiag.mappings.length,
          matrix_cell_count: extraDiag.mappings.length,
          distinct_observed_dates_count: new Set(extraDiag.mappings.map((m) => normalizeText(m?.observedDate || ''))).size,
          mapped_keys_count: new Set(extraDiag.mappings.map((m) => normalizeText(m?.normalizedKey || ''))).size,
          reason: extraDiag.reason || ''
        });
        const existing = Array.isArray(payload.data) ? payload.data : [];
        payload = {
          ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
          data: [...existing, ...extra]
        };
      }
    }
  }

  const reports = flattenReports(payload);
  const report = reports[0] || payload || {};
  const documentType = classifier.normalizeDocumentType(report.document_type || report.documentType || meta.documentType || '');
  const reportDate = classifier.normalizeDateToken(report.report_date || report.reportDate || meta.reportDate || '');
  const patientName = normalizeText(report.patient_name || report.patientName || meta.patientName || '');
  const rows = normalizeRows(report);
  const historyDates = uniqueSortedDates(rows.map((row) => row.date));
  let examDates = uniqueSortedDates([...(report.exam_dates || report.examDates || []), ...historyDates, ...(meta.examDates || [])]);
  if (!examDates.length && reportDate) examDates = [reportDate];
  let latestExamDate = classifier.normalizeDateToken(report.latest_exam_date || report.latestExamDate || meta.latestExamDate || '') || examDates[examDates.length - 1] || reportDate || '';
  const primaryGeminiMinItems = geminiItems.extractPrimaryGeminiMinItems(payload);
  let parsedMinItems = geminiItems.mergePrimaryAndRowFallback(primaryGeminiMinItems, rows);
  const parsedObservedDates = parsedMinItems
    .map((x) => classifier.normalizeDateToken(x?.observedDate || x?.observed_date || ''))
    .filter(Boolean);
  const parsedObservedDistinct = uniqueSortedDates(parsedObservedDates);
  if (runMatrix && parsedObservedDistinct.length >= 2) {
    parsedMinItems = parsedMinItems.map((x) => ({
      ...x,
      source: 'lab_multi_date_matrix'
    }));
  }
  if (parsedObservedDates.length) {
    examDates = uniqueSortedDates([...examDates, ...parsedObservedDates]);
    latestExamDate = latestExamDate || examDates[examDates.length - 1] || '';
  }
  const dateForSyntheticRows = latestExamDate || reportDate || '';
  const rowsForStructured = parsedMinItems.length
    ? geminiItems.minItemsToRowsForGroupRows(parsedMinItems, dateForSyntheticRows)
    : rows;
  const rowFallbackUsed = geminiItems.rowFallbackActive(parsedMinItems, primaryGeminiMinItems.length, rows.length);
  const issues = [
    ...(Array.isArray(meta.issues) ? meta.issues : []),
    ...(Array.isArray(report.issues) ? report.issues : []),
    ...(Array.isArray(payload.issues) ? payload.issues : [])
  ].map(normalizeText).filter(Boolean);
  const items = groupRowsToItems(rowsForStructured, latestExamDate);
  const confidenceValues = rowsForStructured.map((row) => Number(row.confidence || 0)).filter((v) => v > 0);
  const confidence = confidenceValues.length
    ? Math.round((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length) * 100) / 100
    : (Number(report.confidence || payload.confidence || meta.confidence || 0) || 0);

  const reportDataRows = Array.isArray(report?.data) ? report.data : [];
  const qualifiedRecords = geminiItems.countQualifiedParsedItems(parsedMinItems);
  const matrixDiagFinal = runMatrix
    ? labMatrixExtractService.buildMatrixDiagnostics(reportDataRows)
    : null;
  if (runMatrix) {
    console.info('[phasee-new] lab_matrix_final_items', {
      userId: meta.userId || '',
      parsed_items_count: parsedMinItems.length,
      qualified_records_count: qualifiedRecords,
      observed_dates: uniqueSortedDates(parsedObservedDates),
      reason: parsedMinItems.length
        ? (parsedObservedDates.length ? '' : 'observed_dates_empty_after_mapping')
        : (matrixDiagFinal?.reason || 'matrix_detected_but_empty')
    });
  }
  const multiDateRowCount = reportDataRows.filter((r) => r && typeof r === 'object' && (
    (r.values_by_date && typeof r.values_by_date === 'object')
    || extractDateTokensFromText(`${normalizeText(r.column_header_raw || r.columnHeaderRaw || '')} ${normalizeText(r.source_text || r.sourceText || '')}`).length >= 2
  )).length;
  const majorKeys = new Set(['triglycerides_tg', 'ldl_cholesterol', 'hdl_cholesterol', 'ast_got', 'alt_gpt', 'gamma_gtp', 'hba1c', 'creatinine']);
  const majorDateSet = new Set(rows.filter((r) => majorKeys.has(r.normalizedKey) && r.date).map((r) => r.date));
  console.info('[phasee-new] lab_extract_context', {
    userId: meta.userId || '',
    documentType,
    rows: rows.length,
    items: items.length,
    exam_dates: examDates.length,
    latest_exam_date: latestExamDate || '',
    major_dates: majorDateSet.size
  });
  console.info('[phasee-new] lab_history_table_extract_context', {
    userId: meta.userId || '',
    documentType,
    multi_date_row_count: multiDateRowCount,
    observed_dates: historyDates.length,
    major_item_dates: majorDateSet.size
  });
  console.info('[lab-ingest-trace] stage:classifier_vs_extraction', {
    userId: meta.userId,
    classifier_raw_text: normalizeText(meta?.rawText || ''),
    extraction_raw_text: normalizeText(rawText || ''),
    extraction_document_type: normalizeText(report?.document_type || report?.documentType || ''),
    extraction_missing_reason: normalizeText(report?.missing_reason || payload?.missing_reason || ''),
    extraction_data_length: reportDataRows.length,
    extraction_data_sample: reportDataRows.slice(0, 3),
    primary_gemini_items: primaryGeminiMinItems.length,
    parsed_items_json_length: parsedMinItems.length
  });
  let itemChain = 'ok';
  if (!parsedMinItems.length) {
    const dr = report?.data;
    if (!Array.isArray(dr) || dr.length === 0) {
      itemChain = 'no_items:report_data_empty';
    } else if (!primaryGeminiMinItems.length && !rows.length) {
      itemChain = 'no_items:gemini_primary_empty_and_normalizeRows_dropped_all';
    } else {
      itemChain = 'no_items:merged_min_items_empty';
    }
  } else if (primaryGeminiMinItems.length) {
    itemChain = rowFallbackUsed ? 'ok:gemini_primary_plus_row_fallback_merge' : 'ok:gemini_primary_only';
  } else {
    itemChain = 'ok:row_fallback_only';
  }
  if (!parsedMinItems.length) {
    const topLevelKeys = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? Object.keys(payload).slice(0, 20)
      : [];
    const dataArr = Array.isArray(payload?.data) ? payload.data : [];
    const dateOnlyRows = dataArr.filter((r) => classifier.normalizeDateToken(r?.value || '') && !normalizeText(r?.label_in_image || r?.labelInImage || r?.row_label_raw || ''));
    console.info('[lab-ingest-trace] stage:zero_items_diagnostics', {
      userId: meta.userId,
      gemini_raw_empty: !normalizeText(rawCandidateText || rawText),
      gemini_top_level_keys: topLevelKeys,
      structured_result_present: Boolean(payload && (Array.isArray(payload?.data) || topLevelKeys.length)),
      matrix_candidates_count: matrixRowsCount,
      rows_candidates_count: rows.length,
      text_fallback_candidates_count: textRescueRowCount,
      row_fallback_used: rowFallbackUsed,
      row_fallback_unused_reason: rowFallbackUsed ? '' : 'row_fallback_rows_empty_or_unmapped',
      date_only_payload_rows: dateOnlyRows.length,
      parsed_items_empty_reason: itemChain
    });
  }
  labIngestTrace.logRecordsCountReason({
    userId: meta.userId,
    stage: 'lab_structured_extract_after_groupRows',
    details: {
      recordsCount: qualifiedRecords,
      chain: itemChain,
      extractRowCount: rows.length,
      buildStructuredItemsCount: parsedMinItems.length,
      legacyMapItemsCount: items.length,
      primary_gemini_items: primaryGeminiMinItems.length,
      row_fallback_used: rowFallbackUsed
    }
  });

  if (geminiTraceBundle) {
    labIngestTrace.logGeminiAndStructured({
      userId: meta.userId,
      source: 'lab_structured_extract',
      note: 'after_normalize_groupRows_extraction',
      geminiRaw: geminiTraceBundle,
      structuredJsonParsed: payload
    });
  }

  return {
    ok,
    documentType,
    reportDate,
    latestExamDate,
    examDates,
    patientName,
    rows,
    rowsForStructured,
    parsedMinItems,
    primaryGeminiItemCount: primaryGeminiMinItems.length,
    rowFallbackUsed,
    items,
    issues,
    confidence,
    rawText,
    rawPayload: payload,
    promptVersion: builder.promptVersion
  };
}

module.exports = {
  extractStructuredLab,
  KEY_TO_ITEM_NAME
};
