'use strict';

const { countQualifiedPanelRecords, isMinSchemaParsedItems } = require('../lab_gemini_items_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function itemKey(it) {
  return normalizeText(it?.itemName || it?.name || '');
}

/**
 * セッションと canonical の弱い方を補完する。数値付き item は重複名を潰す。
 */
function mergeLabPanels(sessionPanel, canonicalPanel) {
  if (!sessionPanel) return canonicalPanel && typeof canonicalPanel === 'object' ? { ...canonicalPanel } : null;
  if (!canonicalPanel) return { ...sessionPanel };
  const s = sessionPanel;
  const c = canonicalPanel;
  const byName = new Map();
  for (const it of [...(s.items || []), ...(c.items || [])]) {
    const k = itemKey(it) || `anon_${byName.size}`;
    if (!byName.has(k)) {
      byName.set(k, { ...it });
      continue;
    }
    const prev = byName.get(k);
    const v = normalizeText(it?.value || it?.currentValue || '');
    const pv = normalizeText(prev?.value || prev?.currentValue || '');
    if (v && !pv) byName.set(k, { ...prev, ...it });
  }
  const items = [...byName.values()];

  const patientName = normalizeText(s.patientName) || normalizeText(c.patientName) || '';
  const facilityName = normalizeText(s.facilityName) || normalizeText(c.facilityName) || '';
  const printDate = normalizeText(s.printDate) || normalizeText(c.printDate) || '';
  return {
    ...c,
    ...s,
    patientName,
    facilityName,
    printDate,
    meta: {
      patientName,
      facilityName,
      printDate
    },
    latestExamDate: normalizeText(s.latestExamDate) || normalizeText(s.examDate) || normalizeText(c.latestExamDate) || normalizeText(c.examDate) || '',
    examDate: normalizeText(s.examDate) || normalizeText(c.examDate) || '',
    examDates: Array.isArray(s.examDates) && s.examDates.length ? s.examDates : (c.examDates || []),
    items,
    rawText: normalizeText(s.rawText) || normalizeText(c.rawText) || '',
    itemsStructured: mergeItemsStructuredPanels(s?.itemsStructured, c?.itemsStructured),
    metaAdoption: s.metaAdoption || c.metaAdoption || null,
    metaExtraction: s.metaExtraction || c.metaExtraction || null,
    metaConfidence: s.metaConfidence || c.metaConfidence || null
  };
}

function mergeItemsStructuredPanels(sessionStructured, canonicalStructured) {
  const s = Array.isArray(sessionStructured) ? sessionStructured : [];
  const c = Array.isArray(canonicalStructured) ? canonicalStructured : [];
  if (s.length && !c.length) return [...s];
  if (!s.length && c.length) return [...c];
  if (!s.length) return [];
  if (isMinSchemaParsedItems(s) && isMinSchemaParsedItems(c)) {
    const byKey = new Map();
    for (const it of c) {
      const k = normalizeText(it?.normalizedKey);
      if (k) byKey.set(k, { ...it });
    }
    for (const it of s) {
      const k = normalizeText(it?.normalizedKey);
      if (!k) continue;
      const prev = byKey.get(k);
      if (!prev) {
        byKey.set(k, { ...it });
        continue;
      }
      const v = normalizeText(it?.value || '');
      const pv = normalizeText(prev?.value || '');
      byKey.set(k, v && !pv ? { ...prev, ...it } : { ...it, ...prev });
    }
    return [...byKey.values()];
  }
  return [...s];
}

/**
 * 補正・follow用に十分なデータが無いか（空返答に落とさないため補完が必要か）
 */
function isWeakLabPanel(panel) {
  if (!panel || typeof panel !== 'object') return true;
  if (countQualifiedPanelRecords(panel) > 0) return false;
  const items = Array.isArray(panel.items) ? panel.items : [];
  const withValue = items.filter((it) => normalizeText(it?.value || it?.currentValue || '')).length;
  if (withValue > 0) return false;
  if (normalizeText(panel.patientName)) return false;
  if (normalizeText(panel.facilityName)) return false;
  if (normalizeText(panel.printDate)) return false;
  if (Array.isArray(panel.examDates) && panel.examDates.length) return false;
  if (normalizeText(panel.latestExamDate || panel.examDate)) return false;
  if (normalizeText(panel.rawText) && panel.rawText.length > 8) return false;
  if (Array.isArray(panel.items) && panel.items.length && panel.items.some((it) => normalizeText(it?.itemName))) return false;
  return true;
}

module.exports = {
  mergeLabPanels,
  isWeakLabPanel
};
