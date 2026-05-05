'use strict';

const labItemMasterRepository = require('../../repositories/lab_item_master_repository');
const { normalizeLoose, stableUnmappedKey, normalizeText } = require('./lab_result_value_parser_service');

/**
 * @returns {Promise<{ normalized_key: string, display_name: string, from_master: boolean }>}
 */
async function normalizeLabItemName(rawName, masterRows) {
  const raw = normalizeText(rawName);
  if (!raw) {
    return { normalized_key: stableUnmappedKey(''), display_name: '不明', from_master: false };
  }
  const loose = normalizeLoose(raw);
  const rows = Array.isArray(masterRows) ? masterRows : await labItemMasterRepository.getAllActiveMasterRows();
  for (const row of rows) {
    const nk = normalizeText(row.normalized_key);
    if (!nk) continue;
    if (normalizeLoose(nk) === loose || loose.includes(normalizeLoose(nk))) {
      return { normalized_key: nk, display_name: normalizeText(row.display_name_ja) || nk, from_master: true };
    }
    const aliases = Array.isArray(row.aliases_json) ? row.aliases_json : [];
    for (const a of aliases) {
      const al = normalizeLoose(String(a || ''));
      if (al && (loose === al || loose.includes(al) || al.includes(loose))) {
        return { normalized_key: nk, display_name: normalizeText(row.display_name_ja) || nk, from_master: true };
      }
    }
  }
  return {
    normalized_key: stableUnmappedKey(raw),
    display_name: raw,
    from_master: false
  };
}

module.exports = {
  normalizeLabItemName
};
