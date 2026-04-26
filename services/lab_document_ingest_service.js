'use strict';

const labDocumentStoreService = require('./lab_document_store_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function parseNumber(value) {
  const match = normalizeText(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function extractItemsFromText(text) {
  const safe = normalizeText(text);
  if (!safe) return [];

  const patterns = [
    ['HbA1c', /HbA1c\s*[:：]?\s*([0-9.]+)/i],
    ['LDL', /LDL(?:コレステロール)?\s*[:：]?\s*([0-9.]+)/i],
    ['HDL', /HDL(?:コレステロール)?\s*[:：]?\s*([0-9.]+)/i],
    ['TG', /(?:TG|中性脂肪)\s*[:：]?\s*([0-9.]+)/i],
    ['AST', /AST\s*[:：]?\s*([0-9.]+)/i],
    ['ALT', /ALT\s*[:：]?\s*([0-9.]+)/i],
    ['γ-GTP', /(?:γ-GTP|GTP)\s*[:：]?\s*([0-9.]+)/i],
    ['血糖', /血糖\s*[:：]?\s*([0-9.]+)/i],
    ['尿酸', /尿酸\s*[:：]?\s*([0-9.]+)/i],
  ];

  return patterns
    .map(([name, pattern]) => {
      const match = safe.match(pattern);
      if (!match) return null;
      return { name, value: parseNumber(match[1]), raw: match[0] };
    })
    .filter(Boolean);
}

function extractExamDate(text) {
  const safe = normalizeText(text);
  const match = safe.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) return '';
  const [, year, month, day] = match;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function ingestLabDocument({ userId, imagePayload } = {}) {
  const ocrText = normalizeText(imagePayload?.ocrText || imagePayload?.text || '');
  const items = extractItemsFromText(ocrText);
  const labLike = Boolean(items.length || /血液検査|検査結果|HbA1c|LDL|HDL|中性脂肪|TG/i.test(ocrText));
  const examDate = extractExamDate(ocrText);
  const panel = {
    isLabImage: labLike,
    labLike,
    examDate,
    latestExamDate: examDate,
    examDates: examDate ? [examDate] : [],
    items,
    ocrText,
  };

  if (userId && labLike) {
    labDocumentStoreService.savePanelForUser(userId, panel);
  }

  return { ok: true, panel };
}

module.exports = {
  ingestLabDocument,
  extractItemsFromText,
  extractExamDate,
};
