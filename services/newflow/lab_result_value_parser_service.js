'use strict';

const crypto = require('crypto');

function normalizeText(v) {
  return String(v || '').trim();
}

function normalizeLoose(s) {
  return normalizeText(s)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）\-_./・]/g, '');
}

/** "131 mg/dL" -> { valueText, unit } */
function splitValueAndUnit(raw) {
  const t = normalizeText(raw);
  if (!t) return { valueText: '', unit: '' };
  const m = t.match(/^(.+?)\s+(mg\/dL|mmol\/L|U\/L|%|g\/dL|万\/μL|×10\^3\/μL|\/μL|mEq\/L|IU\/L|pg|fL)$/i);
  if (m) return { valueText: normalizeText(m[1]), unit: normalizeText(m[2]) };
  return { valueText: t, unit: '' };
}

/** 範囲のみか（基準レンジ候補） */
function isRangeOnlyString(s) {
  const t = normalizeText(s).replace(/\s+/g, '');
  if (!t) return false;
  return /^\d+(?:\.\d+)?\s*[-〜~−–—]\s*\d+(?:\.\d+)?$/u.test(t);
}

/**
 * @returns {{ valueText: string|null, valueNumeric: number|null, referenceRange: string|null, unit: string|null, parseNote: string|null }}
 */
function parseLabValueFields(candidate = {}) {
  let valueText = normalizeText(candidate.valueText || '');
  let unit = normalizeText(candidate.unit || '');
  let referenceRange = normalizeText(candidate.referenceRange || '');
  let parseNote = null;

  if (!valueText && referenceRange && isRangeOnlyString(referenceRange)) {
    return {
      valueText: null,
      valueNumeric: null,
      referenceRange,
      unit: unit || null,
      parseNote: 'reference_only_in_range_field'
    };
  }

  if (valueText && isRangeOnlyString(valueText)) {
    return {
      valueText: null,
      valueNumeric: null,
      referenceRange: valueText,
      unit: unit || null,
      parseNote: 'value_field_looks_like_reference_range'
    };
  }

  const su = splitValueAndUnit(valueText);
  if (!unit && su.unit) {
    unit = su.unit;
    valueText = su.valueText;
  }

  let valueNumeric = null;
  const lt = /^<\s*([\d.]+)/.exec(valueText);
  const gt = /^>\s*([\d.]+)/.exec(valueText);
  const plainNum = /^([\d.,]+)$/.exec(valueText.replace(/\s+/g, ''));
  if (lt) {
    valueNumeric = Number(lt[1]);
    if (!Number.isFinite(valueNumeric)) valueNumeric = null;
    parseNote = parseNote || 'below_detection';
  } else if (gt) {
    valueNumeric = Number(gt[1]);
    if (!Number.isFinite(valueNumeric)) valueNumeric = null;
  } else if (plainNum) {
    valueNumeric = Number(String(plainNum[1]).replace(/,/g, ''));
    if (!Number.isFinite(valueNumeric)) valueNumeric = null;
  }

  return {
    valueText: valueText || null,
    valueNumeric,
    referenceRange: referenceRange || null,
    unit: unit || null,
    parseNote
  };
}

function stableUnmappedKey(rawName) {
  const h = crypto.createHash('sha256').update(normalizeText(rawName)).digest('hex').slice(0, 12);
  return `unmapped:${h}`;
}

module.exports = {
  parseLabValueFields,
  isRangeOnlyString,
  stableUnmappedKey,
  normalizeLoose,
  normalizeText
};
