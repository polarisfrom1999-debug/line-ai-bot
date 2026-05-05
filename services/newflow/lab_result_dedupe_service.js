'use strict';

const { markConflictingDuplicates } = require('./lab_result_validation_service');

function normalizeText(v) {
  return String(v || '').trim();
}

function keyDateVal(row) {
  const nk = normalizeText(row.normalized_key);
  const od = row.observed_date || 'null';
  const vt = normalizeText(row.value_text);
  return `${nk}|${od}|${vt}`;
}

function keyDate(row) {
  const nk = normalizeText(row.normalized_key);
  const od = row.observed_date || 'null';
  return `${nk}|${od}`;
}

/**
 * @returns {{ rows: object[], stats: object }}
 */
function dedupeLabResultRows(rows = []) {
  const rawCount = rows.length;
  const byTriple = new Map();
  for (const r of rows) {
    const k = keyDateVal(r);
    if (!byTriple.has(k)) byTriple.set(k, []);
    byTriple.get(k).push(r);
  }

  const collapsedTriple = [];
  let skipped_duplicate_count = 0;
  for (const [, group] of byTriple) {
    const prefer = group.sort((a, b) => {
      const ma = a.from_master ? 1 : 0;
      const mb = b.from_master ? 1 : 0;
      if (ma !== mb) return mb - ma;
      return normalizeText(a.source_json_path).length - normalizeText(b.source_json_path).length;
    });
    collapsedTriple.push(prefer[0]);
    if (group.length > 1) skipped_duplicate_count += group.length - 1;
  }

  const byDate = new Map();
  for (const r of collapsedTriple) {
    const k = keyDate(r);
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(r);
  }

  const merged = markConflictingDuplicates(byDate);
  let conflict_count = 0;
  for (const r of merged) {
    if (normalizeText(r.review_reason) === 'conflicting_values_same_key_date') conflict_count += 1;
  }

  const duplicate_keys = [];
  for (const [k, g] of byTriple) {
    if (g.length > 1) duplicate_keys.push(k);
  }

  return {
    rows: merged,
    stats: {
      raw_count: rawCount,
      after_dedupe_count: merged.length,
      skipped_duplicate_count,
      conflict_count,
      duplicate_keys: duplicate_keys.slice(0, 30)
    }
  };
}

module.exports = {
  dedupeLabResultRows
};
