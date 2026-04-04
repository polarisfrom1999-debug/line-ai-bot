"use strict";

const { normalizeItemName, collectTrendRows, buildPanelTrendSummary } = require('./lab_trend_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeDateToken(token) {
  const safe = normalizeText(token);
  if (!safe) return '';
  let m = safe.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = safe.match(/(20\d{2})[\/\.年]\s*(\d{1,2})[\/\.月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = safe.match(/([0-9]{2})[\/\.\-]\s*(\d{1,2})[\/\.\-]\s*(\d{1,2})/);
  if (m) {
    const yy = Number(m[1]);
    const yyyy = yy <= 39 ? 2000 + yy : 1900 + yy;
    return `${yyyy}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  m = safe.match(/R\s*(\d+)\.(\d{1,2})\.(\d{1,2})/i);
  if (m) {
    const year = 2018 + Number(m[1]);
    return `${year}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  return '';
}

function normalizeTarget(text) {
  const safe = normalizeText(text).toUpperCase();
  if (safe.includes('LDL/HDL')) return 'LDL/HDL比';
  if (safe.includes('LDL')) return 'LDL';
  if (safe.includes('HDL')) return 'HDL';
  if (safe.includes('HBA1C') || safe.includes('HB1AC')) return 'HbA1c';
  if (safe.includes('中性脂肪') || safe.includes('TG')) return '中性脂肪';
  if (safe.includes('AST') || safe.includes('GOT')) return 'AST';
  if (safe.includes('ALT') || safe.includes('GPT')) return 'ALT';
  if (safe.includes('GTP')) return 'γ-GTP';
  if (safe.includes('CRE')) return 'クレアチニン';
  if (safe.includes('EGFR')) return 'eGFR';
  if (safe.includes('T-CHO') || safe.includes('総コレステロール') || safe == 'CHO') return '総コレステロール';
  return '';
}

function extractRequestedDate(text) {
  return normalizeDateToken(text);
}

function collectAvailableDates(panel) {
  const set = new Set();
  for (const d of panel?.examDates || []) {
    const nd = normalizeDateToken(d);
    if (nd) set.add(nd);
  }
  const latest = normalizeDateToken(panel?.latestExamDate || panel?.examDate || '');
  if (latest) set.add(latest);
  for (const item of panel?.items || []) {
    for (const row of item?.history || []) {
      const nd = normalizeDateToken(row?.date || '');
      if (nd) set.add(nd);
    }
  }
  return [...set].sort();
}

function buildLabImageReply(panel) {
  const dates = collectAvailableDates(panel);
  const latest = normalizeDateToken(panel?.latestExamDate || panel?.examDate || '') || dates[dates.length - 1] || '';
  if (dates.length >= 2) {
    return [
      '複数の日付を読み取りました。',
      ...dates.map((d) => `・ ${d}`),
      '1日分を確認するなら日付をそのまま送ってください。',
      '全部まとめて保存するなら「読み取れた日付を全部保存」と送ってください。',
      latest ? `今の既定は ${latest} です。` : null,
      'そのまま「TGは？」「HbA1cは？」のように聞いても大丈夫です。'
    ].filter(Boolean).join('\n');
  }
  const previewItems = (panel?.items || []).slice(0, 4).map((item) => `${item.itemName} ${item.value}${item.unit ? ` ${item.unit}` : ''}${item.flag ? ` ${item.flag}` : ''}`);
  return [
    '血液検査の画像を受け取りました。',
    latest ? `検査日: ${latest}` : null,
    previewItems.length ? `主な項目: ${previewItems.join(' / ')}` : null,
    'このまま「TGは？」「HbA1cは？」のように聞いて大丈夫です。'
  ].filter(Boolean).join('\n');
}

function buildDateSelectionReply(date) {
  return `${date} を優先して見ます。このまま「TGは？」「HbA1cは？」のように聞いても大丈夫です。`;
}

function buildSaveReply(panel) {
  const dates = collectAvailableDates(panel);
  return [
    '読み取れた日付をまとめて保持しました。',
    dates.length ? `対象日付: ${dates.join(' / ')}` : null,
    'このまま「TGは？」「今までの傾向は？」のように聞いても大丈夫です。'
  ].filter(Boolean).join('\n');
}

function findItem(panel, targetName) {
  const safe = normalizeTarget(targetName);
  return (panel?.items || []).find((item) => normalizeItemName(item?.itemName || '') === safe) || null;
}

function findValueForDate(panel, targetName, selectedDate) {
  const item = findItem(panel, targetName);
  if (!item) return null;
  const safeDate = normalizeDateToken(selectedDate);
  const latestDate = normalizeDateToken(panel?.latestExamDate || panel?.examDate || '');

  if (safeDate && safeDate === latestDate && normalizeText(item?.value || '')) {
    return {
      date: safeDate,
      itemName: item.itemName,
      value: normalizeText(item.value),
      unit: normalizeText(item.unit || ''),
      flag: normalizeText(item.flag || '')
    };
  }

  for (const row of item?.history || []) {
    const rowDate = normalizeDateToken(row?.date || '');
    if (safeDate && rowDate === safeDate && normalizeText(row?.value || '')) {
      return {
        date: rowDate,
        itemName: item.itemName,
        value: normalizeText(row.value),
        unit: normalizeText(row.unit || item.unit || ''),
        flag: normalizeText(row.flag || '')
      };
    }
  }

  if (!safeDate) {
    const rows = collectTrendRows(panel, item.itemName);
    return rows[rows.length - 1] || null;
  }

  return null;
}

function buildItemReply(panel, targetName, selectedDate) {
  const row = findValueForDate(panel, targetName, selectedDate);
  if (!row) {
    const label = normalizeTarget(targetName) || targetName;
    const date = normalizeDateToken(selectedDate);
    return date
      ? `${label} は ${date} の値がまだ安定して読めていません。別の日付を見るなら日付をそのまま送ってください。`
      : `${label} はまだ安定して読めていません。別の日付を見るなら日付をそのまま送ってください。`;
  }

  const unit = row.unit ? ` ${row.unit}` : '';
  const flag = row.flag ? ` ${row.flag}` : '';
  return `${row.itemName} は ${row.date} で ${row.value}${unit}${flag} です。`;
}

function buildTrendReply(panel, text) {
  const target = normalizeTarget(text || '');
  if (target) {
    const rows = collectTrendRows(panel, target);
    if (!rows.length) return `${target} は、まだ傾向を安定してまとめ切れていません。`;
    const latest = rows[rows.length - 1];
    const historyText = rows.map((r) => `${r.date} ${r.value}${r.unit ? ` ${r.unit}` : ''}${r.flag ? ` ${r.flag}` : ''}`).join(' / ');
    return `${target} の見えている推移は ${historyText} です。最新は ${latest.date} の ${latest.value}${latest.unit ? ` ${latest.unit}` : ''}${latest.flag ? ` ${latest.flag}` : ''} です。`;
  }
  return buildPanelTrendSummary(panel);
}

function shouldHandleTrendQuestion(text) {
  return /傾向|推移|今まで|過去から|比較/.test(normalizeText(text));
}

function shouldHandleSaveAll(text) {
  return /全部保存|読み取れた日付を全部保存|日付を全部保存|まとめて保存/.test(normalizeText(text));
}

module.exports = {
  normalizeTarget,
  extractRequestedDate,
  collectAvailableDates,
  buildLabImageReply,
  buildDateSelectionReply,
  buildSaveReply,
  buildItemReply,
  buildTrendReply,
  shouldHandleTrendQuestion,
  shouldHandleSaveAll,
};
