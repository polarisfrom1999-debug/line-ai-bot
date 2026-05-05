'use strict';

const { isRangeOnlyString } = require('./lab_result_value_parser_service');

function normalizeText(v) {
  return String(v || '').trim();
}

function parseRangeBounds(refStr) {
  const t = normalizeText(refStr).replace(/\s+/g, '');
  const m = t.match(/^([\d.]+)\s*[-〜~−–—]\s*([\d.]+)$/);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { lo, hi };
}

/**
 * 候補行に validation を付与（破棄より needs_manual_review を優先）
 */
function applyValidationRules(row = {}) {
  let validation_status = normalizeText(row.validation_status) || 'ok';
  let review_reason = normalizeText(row.review_reason) || null;

  const vt = normalizeText(row.value_text || '');
  if (vt && isRangeOnlyString(vt)) {
    validation_status = 'needs_manual_review';
    review_reason = review_reason || 'value_looks_like_reference_range';
  }

  const nk = normalizeText(row.normalized_key || '');
  if (nk.startsWith('unmapped:')) {
    validation_status = 'needs_manual_review';
    review_reason = review_reason || 'unmapped_lab_item';
  }

  const rr = parseRangeBounds(row.reference_range || '');
  const vn = row.value_numeric;
  const isLdh = nk === 'ldh' || /(^|[^a-z])ldh([^a-z]|$)/i.test(normalizeText(row.display_name));
  if (rr && Number.isFinite(Number(vn)) && isLdh) {
    const num = Number(vn);
    if (num < rr.lo || num > rr.hi) {
      validation_status = 'needs_manual_review';
      review_reason = review_reason || 'suspicious_value_against_reference_range';
    }
  }

  if (normalizeText(row.observed_date_status) === 'needs_review') {
    validation_status = 'needs_manual_review';
    review_reason = review_reason || row.date_review_reason || 'suspicious_observed_date';
  }

  return { ...row, validation_status, review_reason };
}

function markConflictingDuplicates(groups) {
  /** groups: Map key -> rows[] same normalized_key + observed_date */
  const out = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) {
      out.push(rows[0]);
      continue;
    }
    const vals = new Set(rows.map((r) => normalizeText(r.value_text)));
    if (vals.size <= 1) {
      out.push(rows[0]);
      continue;
    }
    for (const r of rows) {
      out.push({
        ...r,
        validation_status: 'needs_manual_review',
        review_reason: 'conflicting_values_same_key_date'
      });
    }
  }
  return out;
}

module.exports = {
  applyValidationRules,
  markConflictingDuplicates,
  parseRangeBounds
};
