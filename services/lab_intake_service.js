'use strict';

/**
 * services/lab_intake_service.js
 *
 * 役割:
 * - 血液検査文を複数項目で拾いやすくする
 */

function extractLabItems(text) {
  const safe = String(text || '').trim();
  const specs = [
    { itemName: 'LDL', regex: /LDL\s*[:：]?\s*(\d+(?:\.\d+)?)/i },
    { itemName: 'HDL', regex: /HDL\s*[:：]?\s*(\d+(?:\.\d+)?)/i },
    { itemName: '中性脂肪', regex: /中性脂肪\s*[:：]?\s*(\d+(?:\.\d+)?)/i },
    { itemName: 'AST', regex: /AST\s*[:：]?\s*(\d+(?:\.\d+)?)/i },
    { itemName: 'ALT', regex: /ALT\s*[:：]?\s*(\d+(?:\.\d+)?)/i },
    { itemName: 'HbA1c', regex: /HbA1c\s*[:：]?\s*(\d+(?:\.\d+)?)/i }
  ];
  const items = [];
  for (const spec of specs) {
    const match = safe.match(spec.regex);
    if (match) items.push({ itemName: spec.itemName, value: Number(match[1]) });
  }
  return items;
}

function inferLabFollowUpIntent(text) {
  const safe = String(text || '').trim();
  if (/グラフ/.test(safe)) return 'graph_request';
  if (/LDL|HDL|中性脂肪|AST|ALT|HbA1c/i.test(safe)) return 'single_item_question';
  return null;
}

module.exports = {
  extractLabItems,
  inferLabFollowUpIntent
};
