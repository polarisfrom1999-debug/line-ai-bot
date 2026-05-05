'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLoose(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）\-_./・]/g, '');
}

const LAB_ITEM_ALIASES = {
  tg: ['tg', '中性脂肪', 'triglyceride', 'triglycerides', 'トリグリセリド', 'トリグリ'],
  hba1c: ['hba1c', 'a1c', 'hba1cngsp', 'hba1cngsp値', 'hb-a1c', 'ヘモグロビンa1c'],
  ldl: ['ldl', 'ldlc', 'ldlcho', 'ldlコレステロール', 'ldl-cho', 'ldl-c', '悪玉'],
  hdl: ['hdl', 'hdlc', 'hdlcho', 'hdlコレステロール', 'hdl-cho', 'hdl-c', '善玉'],
  wbc: ['wbc', '白血球', '白血球数'],
  ast: ['ast', 'got'],
  alt: ['alt', 'gpt'],
  ldh: ['ldh', '乳酸脱水素酵素', '乳酸脱水素'],
  ggt: ['γgtp', 'γ-gtp', 'ggt', 'γgt', 'g-gtp'],
  ua: ['ua', '尿酸'],
  cr: ['cr', 'cre', 'creatinine', 'クレアチニン'],
  glu: ['glu', 'glucose', 'bs', '血糖', '血糖値']
};

const ALIAS_TO_KEY = (() => {
  const map = new Map();
  for (const [key, aliases] of Object.entries(LAB_ITEM_ALIASES)) {
    for (const alias of aliases) map.set(normalizeLoose(alias), key);
  }
  return map;
})();

function normalizeLabCanonicalKey(text) {
  const raw = normalizeLoose(text);
  if (!raw) return '';
  if (ALIAS_TO_KEY.has(raw)) return ALIAS_TO_KEY.get(raw) || '';
  for (const [alias, key] of ALIAS_TO_KEY.entries()) {
    if (raw.includes(alias) || alias.includes(raw)) return key;
  }
  return '';
}

function canonicalToLabel(key) {
  switch (key) {
    case 'tg': return 'TG';
    case 'hba1c': return 'HbA1c';
    case 'ldl': return 'LDL';
    case 'hdl': return 'HDL';
    case 'wbc': return 'WBC';
    case 'ast': return 'AST';
    case 'alt': return 'ALT';
    case 'ldh': return 'LDH';
    case 'ggt': return 'γ-GTP';
    case 'ua': return '尿酸';
    case 'cr': return 'クレアチニン';
    case 'glu': return '血糖';
    default: return key || '';
  }
}

function pickItemValue(item = {}) {
  const value = normalizeText(item?.value || item?.currentValue || '');
  if (value) return value;
  const history = Array.isArray(item?.history) ? item.history : [];
  const latest = history[history.length - 1] || null;
  return normalizeText(latest?.value || '');
}

function pickRowLabel(row = {}) {
  return normalizeText(
    row?.itemName
    || row?.labelInImage
    || row?.label_in_image
    || row?.display_name
    || row?.name
    || row?.normalized_key
    || row?.normalizedKey
    || ''
  );
}

function pickRowValue(row = {}) {
  const direct = normalizeText(
    row?.value
    || row?.value_text
    || row?.valueText
    || row?.value_numeric
    || row?.valueNumeric
    || ''
  );
  if (direct) return direct;
  const sourceText = normalizeText(row?.sourceText || row?.source_text || '');
  const m = sourceText.match(/-?\d+(?:\.\d+)?/);
  return m ? m[0] : '';
}

function buildMapFromRows(rows = []) {
  const map = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const label = pickRowLabel(row);
    const canonicalKey = normalizeLabCanonicalKey(label);
    if (!canonicalKey) continue;
    const value = pickRowValue(row);
    if (!value) continue;
    const unit = normalizeText(row?.unit || '');
    map[canonicalKey] = {
      canonicalKey,
      label: label || canonicalToLabel(canonicalKey),
      value,
      unit,
      rawLabel: label || canonicalToLabel(canonicalKey)
    };
  }
  return map;
}

function buildLabItemMapFromPanel(panel = {}) {
  const map = {};
  const items = Array.isArray(panel?.items) ? panel.items : [];
  for (const item of items) {
    const displayName = normalizeText(item?.itemName || item?.name || '');
    const canonicalKey = normalizeLabCanonicalKey(displayName);
    if (!canonicalKey) continue;
    const value = pickItemValue(item);
    if (!value) continue;
    const unit = normalizeText(item?.unit || item?.currentUnit || '');
    map[canonicalKey] = {
      canonicalKey,
      label: displayName || canonicalToLabel(canonicalKey),
      value,
      unit,
      rawLabel: displayName || canonicalToLabel(canonicalKey)
    };
  }

  // pending panel では items が空でも structuredRows/rawExtractedItems に値が残るので補完する
  if (!Object.keys(map).length) {
    const rowDerived = buildMapFromRows(panel?.structuredRows || panel?.rawExtractedItems || []);
    for (const [key, value] of Object.entries(rowDerived)) map[key] = value;
  }

  // さらに DB 形式の rawPayload.reports[].data[] からも拾えるようにする
  if (!Object.keys(map).length) {
    const reports = Array.isArray(panel?.rawPayload?.reports)
      ? panel.rawPayload.reports
      : (Array.isArray(panel?.rawPayload?.extracted_reports) ? panel.rawPayload.extracted_reports : []);
    const rawRows = [];
    for (const report of reports) {
      for (const row of Array.isArray(report?.data) ? report.data : []) rawRows.push(row);
    }
    const rowDerived = buildMapFromRows(rawRows);
    for (const [key, value] of Object.entries(rowDerived)) map[key] = value;
  }

  return map;
}

/**
 * OCR/生テキストから主要項目を拾い、buildLabItemMapFromPanel と同形の map を返す。
 * DB 保存前の latestLabCache 補完・lab-qna の cache miss フォールバックに使う。
 */
function buildLabItemMapFromRawText(rawText = '') {
  const safe = normalizeText(rawText);
  if (!safe) return {};

  const out = {};
  const put = (canonicalKey, label, value, unit) => {
    const k = normalizeLabCanonicalKey(canonicalKey) || normalizeLabCanonicalKey(label) || canonicalKey;
    if (!k || out[k]) return;
    const v = normalizeText(String(value || '')).replace(/,/g, '');
    if (!v) return;
    out[k] = {
      canonicalKey: k,
      label: label || canonicalToLabel(k),
      value: v,
      unit: normalizeText(unit || ''),
      rawLabel: label || canonicalToLabel(k)
    };
  };

  const patterns = [
    [/LDL(?:[-‐\s]?コレステロール)?(?:[-‐\s]?C)?\s*[:：＝=]?\s*(-?\d+(?:\.\d+)?)/i, 'ldl', 'LDLコレステロール', 'mg/dL'],
    [/HDL(?:[-‐\s]?コレステロール)?(?:[-‐\s]?C)?\s*[:：＝=]?\s*(-?\d+(?:\.\d+)?)/i, 'hdl', 'HDLコレステロール', 'mg/dL'],
    [/(?:中性脂肪|トリグリセリド|ＴＧ)\s*[:：＝=]?\s*(-?\d+(?:\.\d+)?)/i, 'tg', 'TG', 'mg/dL'],
    [/\bTG\b\s*[:：＝=]?\s*(-?\d+(?:\.\d+)?)/i, 'tg', 'TG', 'mg/dL'],
    [/(?:HbA1c|HBA1C|ヘモグロビン\s*A1c|グリコヘモグロビン)(?:\s*\(NGSP\))?\s*(?:\([^)]*\))?\s*[:：＝=]?\s*(-?\d+(?:\.\d+)?)/i, 'hba1c', 'HbA1c', '%'],
    [/(?:AST|ＡＳＴ|GOT)\s*[:：＝=]?\s*(-?\d+(?:\.\d+)?)/i, 'ast', 'AST', 'U/L'],
    [/(?:ALT|ＡＬＴ|GPT)\s*[:：＝=]?\s*(-?\d+(?:\.\d+)?)/i, 'alt', 'ALT', 'U/L'],
    [/(?:空腹時血糖|随時血糖|血糖(?:値)?|BS|GLU|GLUCOSE)\s*[:：＝=]?\s*(-?\d+(?:\.\d+)?)/i, 'glu', '血糖', 'mg/dL'],
    [/(?:CRE(?:ATININE)?|クレアチニン|Cr)\s*[:：＝=]?\s*(-?\d+(?:\.\d+)?)/i, 'cr', 'クレアチニン', 'mg/dL'],
    [/LDL\s+(-?\d+(?:\.\d+)?)(?:\s*(?:mg\/dL|mg／dL))?/i, 'ldl', 'LDL', 'mg/dL'],
    [/HDL\s+(-?\d+(?:\.\d+)?)(?:\s*(?:mg\/dL|mg／dL))?/i, 'hdl', 'HDL', 'mg/dL']
  ];

  for (const [re, key, label, unit] of patterns) {
    const m = safe.match(re);
    if (m) put(key, label, m[1], unit);
  }

  return out;
}

module.exports = {
  LAB_ITEM_ALIASES,
  normalizeLabCanonicalKey,
  canonicalToLabel,
  buildLabItemMapFromPanel,
  buildLabItemMapFromRawText
};
