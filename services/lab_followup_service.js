'use strict';

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
  m = safe.match(/R\s*(\d+)[\.\/\-](\d{1,2})[\.\/\-](\d{1,2})/i);
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
  if (safe.includes('中性脂肪') || safe.includes('TG') || safe.includes('トリグリ')) return '中性脂肪';
  if (safe.includes('AST') || safe.includes('GOT')) return 'AST';
  if (safe.includes('ALT') || safe.includes('GPT')) return 'ALT';
  if (safe.includes('GTP')) return 'γ-GTP';
  if (safe.includes('CRE')) return 'クレアチニン';
  if (safe.includes('EGFR')) return 'eGFR';
  if (safe.includes('T-CHO') || safe.includes('総コレステロール') || safe === 'CHO') return '総コレステロール';
  if (safe.includes('血糖') || safe.includes('GLUCOSE')) return '血糖';
  if (safe.includes('尿酸')) return '尿酸';
  if (safe.includes('尿素窒素') || safe.includes('BUN')) return '尿素窒素';
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

function listImportantPreview(items = []) {
  const preferred = ['中性脂肪', 'HbA1c', 'LDL', 'HDL', '総コレステロール', 'AST'];
  const lines = [];
  for (const name of preferred) {
    const item = items.find((candidate) => normalizeItemName(candidate?.itemName || '') === normalizeItemName(name) && normalizeText(candidate?.value || ''));
    if (!item) continue;
    lines.push(`${item.itemName} ${item.value}${item.unit ? ` ${item.unit}` : ''}${item.flag ? ` ${item.flag}` : ''}`);
  }
  return lines.slice(0, 4);
}

function buildLabImageReply(panel) {
  const dates = collectAvailableDates(panel);
  const latest = normalizeDateToken(panel?.latestExamDate || panel?.examDate || '') || dates[dates.length - 1] || '';
  const issues = Array.isArray(panel?.issues) ? panel.issues.filter(Boolean) : [];
  if ((panel?.documentKind || '').includes('multi') || dates.length >= 2) {
    const preview = listImportantPreview(panel?.items || []);
    return [
      '血液検査の画像を受け取りました。今回は推移表として整理しています。',
      dates.length ? `読み取れた日付: ${dates.join(' / ')}` : null,
      latest ? `今の既定は ${latest} です。` : null,
      preview.length ? `主な値: ${preview.join(' / ')}` : null,
      issues.length ? `注意: ${issues[0]}` : null,
      'このまま「TGは？」「HbA1cは？」「今までの傾向は？」のように聞いて大丈夫です。'
    ].filter(Boolean).join('\n');
  }

  const preview = listImportantPreview(panel?.items || []);
  return [
    '血液検査の画像を受け取りました。今回は1日分の検査として整理しています。',
    latest ? `検査日: ${latest}` : null,
    preview.length ? `主な値: ${preview.join(' / ')}` : null,
    issues.length ? `注意: ${issues[0]}` : null,
    'このまま「TGは？」「LDLは？」「HbA1cは？」のように聞いて大丈夫です。'
  ].filter(Boolean).join('\n');
}

function buildDateSelectionReply(date) {
  return `${date} を優先して見ます。このまま「TGは？」「HbA1cは？」のように聞いて大丈夫です。`;
}

function buildUnavailableDateReply(panel, requestedDate) {
  const dates = collectAvailableDates(panel);
  if (!dates.length) return `${requestedDate} はまだ確認できませんでした。`;
  return `${requestedDate} は今回の画像では見つかりませんでした。読み取れた日付は ${dates.join(' / ')} です。`;
}

function buildSaveReply(panel) {
  const dates = collectAvailableDates(panel);
  return [
    '読み取れた日付をまとめて保持しました。',
    dates.length ? `対象日付: ${dates.join(' / ')}` : null,
    'このまま「TGは？」「今までの傾向は？」のように聞いて大丈夫です。'
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
  const rows = collectTrendRows(panel, item.itemName);
  if (!rows.length) return null;
  if (safeDate) return rows.find((row) => row.date === safeDate) || null;
  return rows[rows.length - 1] || null;
}

function buildReferenceSentence(row) {
  const low = row?.referenceLow;
  const high = row?.referenceHigh;
  if (low == null && high == null) return '';
  if (low != null && high != null) return `基準 ${low}〜${high}`;
  if (low != null) return `基準下限 ${low}`;
  return `基準上限 ${high}`;
}

function buildFlagSentence(row) {
  if (row?.flag === 'H') return 'やや高めです。';
  if (row?.flag === 'L') return 'やや低めです。';
  return '基準内です。';
}

function buildItemReply(panel, targetName, selectedDate) {
  const row = findValueForDate(panel, targetName, selectedDate);
  if (!row) {
    const label = normalizeTarget(targetName) || targetName;
    const date = normalizeDateToken(selectedDate);
    const availableDates = collectAvailableDates(panel);
    if (date && availableDates.includes(date)) {
      return `${label} は ${date} の値をまだ安定して拾い切れていません。保存が完了したら保存済みデータから返します。`;
    }
    return `${label} は今回の画像ではまだ安定して拾い切れていません。保存が完了したら保存済みデータから返します。`;
  }

  const unit = row.unit ? ` ${row.unit}` : '';
  const reference = buildReferenceSentence(row);
  const flagSentence = buildFlagSentence(row);
  return [
    `${row.itemName} は ${row.date} で ${row.value}${unit} です。`,
    reference ? `${reference} で、${flagSentence}` : flagSentence
  ].filter(Boolean).join(' ');
}

function buildTrendReply(panel, text) {
  const target = normalizeTarget(text || '');
  if (target) {
    const rows = collectTrendRows(panel, target);
    if (!rows.length) return `${target} は、まだ傾向を安定してまとめ切れていません。`;
    const latest = rows[rows.length - 1];
    const highest = [...rows].sort((a, b) => Number(b.value) - Number(a.value))[0];
    const lowest = [...rows].sort((a, b) => Number(a.value) - Number(b.value))[0];
    const latestLabel = `${latest.value}${latest.unit ? ` ${latest.unit}` : ''}${latest.flag ? ` ${latest.flag}` : ''}`;
    const highestLabel = `${highest.value}${highest.unit ? ` ${highest.unit}` : ''}${highest.flag ? ` ${highest.flag}` : ''}`;
    const lowestLabel = `${lowest.value}${lowest.unit ? ` ${lowest.unit}` : ''}${lowest.flag ? ` ${lowest.flag}` : ''}`;
    return [
      `${target} の見えている推移です。`,
      `最新: ${latest.date} ${latestLabel}`,
      rows.length >= 2 ? `高かった日: ${highest.date} ${highestLabel}` : null,
      rows.length >= 2 ? `低かった日: ${lowest.date} ${lowestLabel}` : null,
      `並び: ${rows.map((r) => `${r.date} ${r.value}${r.flag ? r.flag : ''}`).join(' / ')}`
    ].filter(Boolean).join('\n');
  }
  return buildPanelTrendSummary(panel);
}

function shouldHandleTrendQuestion(text) {
  return /傾向|推移|今まで|過去から|比較|一番高/.test(normalizeText(text));
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
  buildUnavailableDateReply,
  buildSaveReply,
  buildItemReply,
  buildTrendReply,
  shouldHandleTrendQuestion,
  shouldHandleSaveAll,
};
