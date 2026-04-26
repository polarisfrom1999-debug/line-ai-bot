'use strict';

const LAB_ALIASES = new Map([
  ['中性脂肪', ['中性脂肪', 'TG', 'トリグリセリド']],
  ['HbA1c', ['HbA1c', 'ヘモグロビンA1c']],
  ['LDL', ['LDL', 'LDL-C', '悪玉']],
  ['HDL', ['HDL', 'HDL-C', '善玉']],
  ['AST', ['AST', 'GOT']],
  ['ALT', ['ALT', 'GPT']],
  ['γ-GTP', ['γ-GTP', 'GTP', 'ガンマ']],
  ['血糖', ['血糖', 'GLU']],
  ['尿酸', ['尿酸', 'UA']]
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function getItems(panel) {
  return Array.isArray(panel?.items) ? panel.items : [];
}

function getItemName(item) {
  return normalizeText(item?.name || item?.label || item?.itemName || item?.key);
}

function getItemValue(item) {
  return normalizeText(item?.value ?? item?.result ?? item?.numericValue ?? '');
}

function getItemUnit(item) {
  return normalizeText(item?.unit || '');
}

function getItemDate(item, panel) {
  return normalizeText(item?.examDate || panel?.latestExamDate || panel?.examDate || '');
}

function collectAvailableDates(panel) {
  const dates = new Set();
  for (const key of ['latestExamDate', 'examDate']) {
    if (panel?.[key]) dates.add(String(panel[key]));
  }
  if (Array.isArray(panel?.examDates)) {
    for (const date of panel.examDates) if (date) dates.add(String(date));
  }
  for (const item of getItems(panel)) {
    if (item?.examDate) dates.add(String(item.examDate));
  }
  return [...dates];
}

function normalizeTarget(text) {
  const safe = normalizeText(text);
  if (!safe) return '';

  for (const [canonical, aliases] of LAB_ALIASES.entries()) {
    if (aliases.some((alias) => new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(safe))) {
      return canonical;
    }
  }
  return '';
}

function findTargetItem(panel, targetName, selectedDate = '') {
  const aliases = LAB_ALIASES.get(targetName) || [targetName];
  const items = getItems(panel);
  return items.find((item) => {
    const name = getItemName(item);
    const date = getItemDate(item, panel);
    const matchesName = aliases.some((alias) => new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(name));
    const matchesDate = !selectedDate || !date || date === selectedDate;
    return matchesName && matchesDate;
  }) || null;
}

function buildLabImageReply(panel) {
  const count = getItems(panel).length;
  const latestDate = panel?.latestExamDate || panel?.examDate || '';
  const dateText = latestDate ? `${latestDate} の` : '';
  return `血液検査画像を受け取りました。${dateText}検査として、${count}項目を読み取っています。気になる項目名を送ってください。`;
}

function buildItemReply(panel, targetName, selectedDate = '') {
  const item = findTargetItem(panel, targetName, selectedDate);
  if (!item) return `${targetName} はまだ安定して読めていません。血液検査の画像をもう一度送ってもらえれば、その画像を優先して見ます。`;

  const value = getItemValue(item);
  const unit = getItemUnit(item);
  const date = getItemDate(item, panel);
  return `${date ? `${date} の` : ''}${targetName} は ${value}${unit ? ` ${unit}` : ''} です。`;
}

function shouldHandleTrendQuestion(text) {
  return /傾向|推移|変化|前回|今まで/.test(normalizeText(text));
}

function buildTrendReply(panel) {
  const dates = collectAvailableDates(panel);
  if (dates.length <= 1) return '今ある検査画像では、傾向を見るには日付がまだ少なそうです。';
  return `確認できる日付は ${dates.join('、')} です。気になる項目名を送ると、その項目ごとに見ます。`;
}

function extractRequestedDate(text) {
  const match = normalizeText(text).match(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/);
  if (!match) return '';
  return match[0].replace(/[年月/]/g, '-').replace(/日$/, '').replace(/-(\d)(?=-|$)/g, '-0$1');
}

function buildUnavailableDateReply(panel, selectedDate) {
  const dates = collectAvailableDates(panel);
  return `${selectedDate} の検査はまだ見つかりません。今見られる日付は ${dates.join('、') || 'まだありません'} です。`;
}

function buildDateSelectionReply(selectedDate) {
  return `${selectedDate} の検査を優先して見ます。気になる項目名を送ってください。`;
}

function shouldHandleSaveAll(text) {
  return /全部保存|すべて保存|全て保存|保存して/.test(normalizeText(text));
}

function buildSaveReply(panel) {
  return `血液検査の項目を保存しました。${getItems(panel).length}項目を今後の会話で参照できます。`;
}

module.exports = {
  buildLabImageReply,
  shouldHandleTrendQuestion,
  buildTrendReply,
  normalizeTarget,
  buildItemReply,
  extractRequestedDate,
  collectAvailableDates,
  buildUnavailableDateReply,
  buildDateSelectionReply,
  shouldHandleSaveAll,
  buildSaveReply
};
