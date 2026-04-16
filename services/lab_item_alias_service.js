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
  return map;
}

module.exports = {
  LAB_ITEM_ALIASES,
  normalizeLabCanonicalKey,
  canonicalToLabel,
  buildLabItemMapFromPanel
};
