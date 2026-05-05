'use strict';

const labItemMasterRepository = require('../../repositories/lab_item_master_repository');
const { normalizeLoose, stableUnmappedKey, normalizeText } = require('./lab_result_value_parser_service');

const INCOMING_KEY_SOURCES = new Set(['json.normalizedKey', 'json.normalized_key', 'json.canonical_key']);

/** normalizeLoose(text) → lab_item_master.normalized_key（マスタ未登録時の保険） */
const FALLBACK_LOOSE_TO_KEY = {
  中性脂肪: 'triglycerides_tg',
  tg: 'triglycerides_tg',
  トリグリ: 'triglycerides_tg',
  トリグリセリド: 'triglycerides_tg',
  triglyceride: 'triglycerides_tg',
  triglycerides: 'triglycerides_tg',
  hba1c: 'hba1c',
  hb1ac: 'hba1c',
  a1c: 'hba1c',
  糖化ヘモグロビン: 'hba1c',
  ldh: 'ldh',
  γgtp: 'ggt',
  ggt: 'ggt',
  cpk: 'cpk',
  ck: 'cpk',
  クレアチンリンキン酵素: 'cpk',
  ast: 'ast_got',
  got: 'ast_got',
  alt: 'alt_gpt',
  gpt: 'alt_gpt',
  血糖: 'glucose',
  血糖値: 'glucose',
  glucose: 'glucose',
  cre: 'creatinine',
  cr: 'creatinine',
  creatinine: 'creatinine',
  クレアチニン: 'creatinine',
  ヘモグロビン: 'hemoglobin',
  hgb: 'hemoglobin',
  hemoglobin: 'hemoglobin',
  血色素量: 'hemoglobin'
};

function isGarbageNormalizedKey(k) {
  const t = normalizeText(k);
  if (!t) return true;
  if (t.startsWith('unmapped:')) return true;
  if (/^raw_label:/i.test(t)) return true;
  return false;
}

function extractIncomingNormalizedKey(rawItemJson) {
  if (!rawItemJson || typeof rawItemJson !== 'object') return '';
  return normalizeText(
    rawItemJson.normalizedKey || rawItemJson.normalized_key || rawItemJson.canonical_key || ''
  );
}

/**
 * rawName 優先。normalizedKey は最後に試し、盲信しない（garbage はスキップ）。
 * @returns {{ text: string, source: string }[]}
 */
function buildOrderedLookupStrings(rawName, rawItemJson) {
  const out = [];
  const seen = new Set();
  function add(text, source) {
    const t = normalizeText(text);
    if (!t || seen.has(t)) return;
    if (isGarbageNormalizedKey(t) && INCOMING_KEY_SOURCES.has(source)) return;
    seen.add(t);
    out.push({ text: t, source });
  }

  add(rawName, 'raw_name');
  if (rawItemJson && typeof rawItemJson === 'object') {
    add(rawItemJson.name, 'json.name');
    add(rawItemJson.label, 'json.label');
    add(rawItemJson.itemName, 'json.itemName');
    add(rawItemJson.displayName, 'json.displayName');
    add(rawItemJson.display_name, 'json.display_name');
    add(rawItemJson.rawName, 'json.rawName');
    add(rawItemJson.raw_label, 'json.raw_label');
    add(rawItemJson.normalizedKey, 'json.normalizedKey');
    add(rawItemJson.normalized_key, 'json.normalized_key');
    add(rawItemJson.canonical_key, 'json.canonical_key');
  }
  return out;
}

function masterRowByKey(masterRows, nk) {
  const want = normalizeText(nk);
  return masterRows.find((r) => normalizeText(r.normalized_key) === want) || null;
}

/**
 * @returns {Promise<{ normalized_key: string, display_name: string, from_master: boolean, resolvedBy: string }>}
 */
async function normalizeLabItemName(rawName, masterRows) {
  const raw = normalizeText(rawName);
  if (!raw) {
    return { normalized_key: stableUnmappedKey(''), display_name: '不明', from_master: false, resolvedBy: 'unmapped' };
  }
  const loose = normalizeLoose(raw);
  const rows = Array.isArray(masterRows) ? masterRows : await labItemMasterRepository.getAllActiveMasterRows();
  for (const row of rows) {
    const nk = normalizeText(row.normalized_key);
    if (!nk) continue;
    if (normalizeLoose(nk) === loose || loose.includes(normalizeLoose(nk))) {
      return {
        normalized_key: nk,
        display_name: normalizeText(row.display_name_ja) || nk,
        from_master: true,
        resolvedBy: 'master_alias'
      };
    }
    const aliases = Array.isArray(row.aliases_json) ? row.aliases_json : [];
    for (const a of aliases) {
      const al = normalizeLoose(String(a || ''));
      if (al && (loose === al || loose.includes(al) || al.includes(loose))) {
        return {
          normalized_key: nk,
          display_name: normalizeText(row.display_name_ja) || nk,
          from_master: true,
          resolvedBy: 'master_alias'
        };
      }
    }
  }
  return {
    normalized_key: stableUnmappedKey(raw),
    display_name: raw,
    from_master: false,
    resolvedBy: 'unmapped'
  };
}

/**
 * 保存用: マスタ＋明示フォールバックで canonical に寄せる。parsed の normalizedKey は盲信しない。
 * @returns {Promise<{ normalized_key: string, display_name: string, from_master: boolean, resolvedBy: 'master_alias'|'incoming_canonical'|'fallback_map'|'unmapped' }>}
 */
async function resolveLabItemForPersistence(rawName, rawItemJson, masterRows) {
  const rows = Array.isArray(masterRows) ? masterRows : await labItemMasterRepository.getAllActiveMasterRows();
  const incomingNorm = extractIncomingNormalizedKey(rawItemJson);
  const ordered = buildOrderedLookupStrings(rawName, rawItemJson);

  for (const { text, source } of ordered) {
    if (isGarbageNormalizedKey(text)) continue;
    const r = await normalizeLabItemName(text, rows);
    if (r.from_master) {
      const resolvedBy = INCOMING_KEY_SOURCES.has(source) ? 'incoming_canonical' : 'master_alias';
      return {
        normalized_key: r.normalized_key,
        display_name: r.display_name,
        from_master: true,
        resolvedBy
      };
    }
  }

  if (!isGarbageNormalizedKey(incomingNorm)) {
    const hit = masterRowByKey(rows, incomingNorm);
    if (hit) {
      return {
        normalized_key: normalizeText(hit.normalized_key),
        display_name: normalizeText(hit.display_name_ja) || hit.normalized_key,
        from_master: true,
        resolvedBy: 'incoming_canonical'
      };
    }
  }

  for (const { text } of ordered) {
    if (!normalizeText(text)) continue;
    const loose = normalizeLoose(text);
    const fbKey = FALLBACK_LOOSE_TO_KEY[loose] || FALLBACK_LOOSE_TO_KEY[normalizeText(text).toLowerCase()];
    if (fbKey) {
      const hit = masterRowByKey(rows, fbKey);
      return {
        normalized_key: fbKey,
        display_name: hit ? normalizeText(hit.display_name_ja) || fbKey : normalizeText(text) || fbKey,
        from_master: Boolean(hit),
        resolvedBy: 'fallback_map'
      };
    }
  }

  const primaryLabel = normalizeText(rawName) || normalizeText(incomingNorm) || '不明';
  return {
    normalized_key: stableUnmappedKey(primaryLabel),
    display_name: primaryLabel,
    from_master: false,
    resolvedBy: 'unmapped'
  };
}

function logLabItemNormalizerDebug(payload) {
  console.info('[lab_item_normalizer_debug]', {
    rawName: payload.rawName,
    incomingNormalizedKey: payload.incomingNormalizedKey ?? null,
    resolvedNormalizedKey: payload.resolvedNormalizedKey,
    resolvedBy: payload.resolvedBy,
    displayName: payload.displayName
  });
}

module.exports = {
  normalizeLabItemName,
  resolveLabItemForPersistence,
  logLabItemNormalizerDebug,
  FALLBACK_LOOSE_TO_KEY
};
