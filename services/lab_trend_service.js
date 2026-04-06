"use strict";

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeItemName(name) {
  const safe = normalizeText(name)
    .replace(/ＬＤＬ/gi, 'LDL')
    .replace(/ＨＤＬ/gi, 'HDL')
    .replace(/ＴＧ/gi, 'TG')
    .replace(/ＨｂＡ１ｃ/gi, 'HbA1c')
    .replace(/γＧＴＰ/gi, 'γ-GTP')
    .replace(/γGTP/gi, 'γ-GTP')
    .replace(/総コレステロール|T-CHO|CHO/gi, '総コレステロール')
    .replace(/LDL\/HDL比/gi, 'LDL/HDL比')
    .replace(/中性脂肪|トリグリセリド/gi, '中性脂肪')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^TG$/i.test(safe)) return '中性脂肪';
  if (/^GOT$/i.test(safe)) return 'AST';
  if (/^GPT$/i.test(safe)) return 'ALT';
  return safe;
}

function normalizeDate(value) {
  const safe = normalizeText(value);
  const m = safe.match(/(20\d{2})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function uniqueBy(rows, keyFn) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function sortByDate(rows) {
  return [...rows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

function collectTrendRows(panel, itemName) {
  const safeName = normalizeItemName(itemName);
  const items = Array.isArray(panel?.items) ? panel.items : [];
  const rows = [];

  for (const item of items) {
    if (normalizeItemName(item?.itemName || '') !== safeName) continue;
    const unit = normalizeText(item?.unit || '');
    const history = Array.isArray(item?.history) ? item.history : [];
    for (const row of history) {
      const date = normalizeDate(row?.date || '');
      const value = normalizeText(row?.value || '');
      if (!date || !value) continue;
      rows.push({
        date,
        itemName: safeName,
        value,
        unit: normalizeText(row?.unit || unit),
        flag: normalizeText(row?.flag || ''),
        referenceLow: row?.referenceLow ?? null,
        referenceHigh: row?.referenceHigh ?? null
      });
    }

    const currentDate = normalizeDate(panel?.latestExamDate || panel?.examDate || '');
    const currentValue = normalizeText(item?.value || item?.currentValue || '');
    if (currentDate && currentValue) {
      rows.push({
        date: currentDate,
        itemName: safeName,
        value: currentValue,
        unit,
        flag: normalizeText(item?.flag || item?.currentFlag || ''),
        referenceLow: item?.referenceLow ?? null,
        referenceHigh: item?.referenceHigh ?? null
      });
    }
  }

  return sortByDate(uniqueBy(rows, (row) => `${row.date}:${row.itemName}:${row.value}:${row.unit}:${row.flag}`));
}

function buildTrendSentence(itemName, rows) {
  if (!rows.length) return '';
  const latest = rows[rows.length - 1];
  const first = rows[0];
  const latestLabel = `${latest.value}${latest.unit ? ` ${latest.unit}` : ''}${latest.flag ? ` ${latest.flag}` : ''}`;
  if (rows.length === 1) return `${itemName} は ${latest.date} で ${latestLabel} です。`;
  const firstLabel = `${first.value}${first.unit ? ` ${first.unit}` : ''}${first.flag ? ` ${first.flag}` : ''}`;
  return `${itemName} は ${first.date} の ${firstLabel} から、${latest.date} では ${latestLabel} へ推移しています。`;
}

function buildPanelTrendSummary(panel) {
  const lines = [];
  const targetOrder = ['総コレステロール', 'LDL', 'HDL', 'LDL/HDL比', '中性脂肪', 'HbA1c', 'AST', 'ALT', 'γ-GTP', 'クレアチニン', 'eGFR'];
  for (const itemName of targetOrder) {
    const rows = collectTrendRows(panel, itemName);
    const line = buildTrendSentence(itemName, rows);
    if (line) lines.push(line);
  }
  if (!lines.length) return '今回の画像では、まだ傾向を安定してまとめ切れていません。';
  return lines.slice(0, 5).join('\n');
}

module.exports = {
  normalizeItemName,
  collectTrendRows,
  buildPanelTrendSummary,
};
