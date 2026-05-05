'use strict';

/**
 * Gemini / structured JSON の形に依存せず、再帰的に検査候補を抽出する。
 */

const NAME_KEYS = new Set([
  'name', 'label', 'raw_label', 'rawName', 'test_name', 'item_name', 'item', 'key',
  'canonical_key', 'display_name', 'displayName', 'itemName', 'normalized_key', 'normalizedKey'
]);
const VALUE_KEYS = new Set([
  'value', 'result', 'result_value', 'value_text', 'valueText', 'numeric_value', 'currentValue'
]);
const UNIT_KEYS = new Set(['unit', 'units']);
const REF_KEYS = new Set([
  'reference_range', 'referenceRange', 'normal_range', 'range', '基準範囲', 'reference'
]);
const DATE_KEYS = new Set([
  'observed_date', 'exam_date', 'test_date', 'date', '検査日', '採取日', 'observedDate'
]);
const FLAG_KEYS = new Set(['flag', '判定', 'status', 'abnormal_flag']);

function normalizeText(v) {
  return String(v || '').trim();
}

/** parsed_items_json で raw_label: 付きラベルが先に来ても、保存・正規化用の表示名を復元する */
function stripRawLabelPrefix(s) {
  const t = normalizeText(s);
  const m = /^raw_label:\s*(.+)$/i.exec(t);
  return m ? normalizeText(m[1]) : t;
}

function pickParsedItemRawName(it) {
  if (!it || typeof it !== 'object') return '';
  const fields = [it.name, it.rawName, it.itemName, it.label, it.displayName, it.display_name];
  for (const f of fields) {
    const t = stripRawLabelPrefix(f);
    if (t && !normalizeText(t).startsWith('unmapped:')) return t;
  }
  const nk = stripRawLabelPrefix(it.normalizedKey || it.normalized_key || '');
  if (nk && !normalizeText(nk).startsWith('unmapped:')) return nk;
  return stripRawLabelPrefix(
    normalizeText(it.normalizedKey || it.name || it.rawName || it.itemName || it.label || '')
  );
}

function isPlainObject(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function looksLikeDateKey(k) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(k).trim());
}

/**
 * @returns {{ rawName: string, valueText?: string, unit?: string, referenceRange?: string, flag?: string,
 *   observedDateText?: string, sourceJsonPath: string, rawItemJson: object }[]}
 */
function extractCandidatesFromJson(root, options = {}) {
  const maxDepth = Number(options.maxDepth) > 0 ? Number(options.maxDepth) : 28;
  const out = [];
  const seenPath = new Set();

  function emit(candidate, path) {
    const sp = String(path);
    if (seenPath.has(sp)) return;
    seenPath.add(sp);
    out.push({
      rawName: normalizeText(candidate.rawName),
      valueText: candidate.valueText != null ? String(candidate.valueText) : '',
      unit: normalizeText(candidate.unit),
      referenceRange: normalizeText(candidate.referenceRange),
      flag: normalizeText(candidate.flag),
      observedDateText: normalizeText(candidate.observedDateText),
      sourceJsonPath: path,
      rawItemJson: candidate.rawItemJson && typeof candidate.rawItemJson === 'object'
        ? candidate.rawItemJson
        : {}
    });
  }

  function pickFields(o) {
    if (!isPlainObject(o)) return null;
    let rawName = '';
    for (const k of NAME_KEYS) {
      if (o[k] != null && normalizeText(o[k])) {
        rawName = normalizeText(typeof o[k] === 'object' ? JSON.stringify(o[k]) : o[k]);
        if (rawName) break;
      }
    }
    let valueText = '';
    for (const k of VALUE_KEYS) {
      const v = o[k];
      if (v != null && typeof v !== 'object') {
        const s = normalizeText(String(v));
        if (s) {
          valueText = s;
          break;
        }
      }
    }
    let unit = '';
    for (const k of UNIT_KEYS) {
      if (o[k]) {
        unit = normalizeText(o[k]);
        break;
      }
    }
    let referenceRange = '';
    for (const k of REF_KEYS) {
      if (o[k]) {
        referenceRange = normalizeText(typeof o[k] === 'object' ? JSON.stringify(o[k]) : o[k]);
        break;
      }
    }
    let observedDateText = '';
    for (const k of DATE_KEYS) {
      if (o[k]) {
        observedDateText = normalizeText(typeof o[k] === 'object' ? '' : o[k]);
        break;
      }
    }
    let flag = '';
    for (const k of FLAG_KEYS) {
      if (o[k]) {
        flag = normalizeText(o[k]);
        break;
      }
    }
    rawName = stripRawLabelPrefix(rawName);
    return { rawName, valueText, unit, referenceRange, flag, observedDateText };
  }

  function handleValuesObject(parentObj, valuesObj, basePath, rawName) {
    if (!isPlainObject(valuesObj) || !normalizeText(rawName)) return;
    for (const [dk, vv] of Object.entries(valuesObj)) {
      if (!looksLikeDateKey(dk) && !normalizeText(dk)) continue;
      const dateTxt = looksLikeDateKey(dk) ? dk : dk;
      const valStr = vv != null && typeof vv !== 'object' ? normalizeText(String(vv)) : '';
      const path = `${basePath}.values["${dk}"]`;
      emit({
        rawName,
        valueText: valStr,
        unit: normalizeText(parentObj.unit || parentObj.units),
        referenceRange: '',
        flag: normalizeText(parentObj.flag),
        observedDateText: dateTxt,
        rawItemJson: { ...parentObj, _unpivotDate: dk, _unpivotValue: vv }
      }, path);
    }
  }

  function walk(node, path, depth) {
    if (node == null || depth > maxDepth) return;
    if (Array.isArray(node)) {
      node.forEach((el, i) => walk(el, `${path}[${i}]`, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;

    const picked = pickFields(node);
    if (picked && normalizeText(picked.rawName)) {
      if (isPlainObject(node.values)) {
        handleValuesObject(node, node.values, path, picked.rawName);
      } else if (normalizeText(picked.valueText) || normalizeText(picked.referenceRange)) {
        emit({ ...picked, rawItemJson: node }, path || '$');
      }
    }

    if (isPlainObject(node.values) && !picked?.rawName) {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'values' && isPlainObject(v)) {
          for (const dk of Object.keys(v)) {
            walk({ ...node, name: node.name || node.item || k, values: { [dk]: v[dk] } }, `${path}.${k}`, depth + 1);
          }
        }
      }
    }

    for (const [k, v] of Object.entries(node)) {
      if (k === 'values' && isPlainObject(node.values) && normalizeText(pickFields(node)?.rawName)) {
        continue;
      }
      walk(v, path ? `${path}.${k}` : k, depth + 1);
    }
  }

  walk(root, '$', 0);
  return out.filter((c) => normalizeText(c.rawName));
}

function extractFromParsedItemsJson(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  for (let i = 0; i < arr.length; i += 1) {
    const it = arr[i];
    if (!it || typeof it !== 'object') continue;
    const rawName = pickParsedItemRawName(it);
    const valueText = normalizeText(it.value || it.result_value || it.currentValue || '');
    const unit = normalizeText(it.unit || '');
    const referenceRange = normalizeText(it.referenceLow != null && it.referenceHigh != null
      ? `${it.referenceLow}-${it.referenceHigh}`
      : it.reference_range || it.referenceRange || '');
    const flag = normalizeText(it.flag || '');
    const observedDateText = normalizeText(it.observedDate || it.observed_date || it.date || '');
    out.push({
      rawName: rawName || stripRawLabelPrefix(it.normalizedKey || it.normalized_key || ''),
      valueText,
      unit,
      referenceRange,
      flag,
      observedDateText,
      sourceJsonPath: `parsed_items_json[${i}]`,
      rawItemJson: it
    });
  }
  return out.filter((c) => normalizeText(c.rawName));
}

function mergeExtractorOutputs(structuredRoot, parsedArr) {
  const a = structuredRoot != null ? extractCandidatesFromJson(structuredRoot) : [];
  const b = extractFromParsedItemsJson(parsedArr || []);
  const byPath = new Map();
  for (const x of [...a, ...b]) {
    const k = `${x.sourceJsonPath}|${normalizeText(x.rawName)}|${normalizeText(x.observedDateText)}`;
    if (!byPath.has(k)) byPath.set(k, x);
  }
  return [...byPath.values()];
}

module.exports = {
  extractCandidatesFromJson,
  extractFromParsedItemsJson,
  mergeExtractorOutputs,
  NAME_KEYS,
  VALUE_KEYS
};
