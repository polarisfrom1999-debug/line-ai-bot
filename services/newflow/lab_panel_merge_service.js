'use strict';

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

  return {
    ...c,
    ...s,
    patientName: normalizeText(s.patientName) || normalizeText(c.patientName) || '',
    facilityName: normalizeText(s.facilityName) || normalizeText(c.facilityName) || '',
    printDate: normalizeText(s.printDate) || normalizeText(c.printDate) || '',
    latestExamDate: normalizeText(s.latestExamDate) || normalizeText(s.examDate) || normalizeText(c.latestExamDate) || normalizeText(c.examDate) || '',
    examDate: normalizeText(s.examDate) || normalizeText(c.examDate) || '',
    examDates: Array.isArray(s.examDates) && s.examDates.length ? s.examDates : (c.examDates || []),
    items,
    rawText: normalizeText(s.rawText) || normalizeText(c.rawText) || '',
    itemsStructured: Array.isArray(s.itemsStructured) && s.itemsStructured.length ? s.itemsStructured : (c.itemsStructured || [])
  };
}

/**
 * 補正・follow用に十分なデータが無いか（空返答に落とさないため補完が必要か）
 */
function isWeakLabPanel(panel) {
  if (!panel || typeof panel !== 'object') return true;
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
