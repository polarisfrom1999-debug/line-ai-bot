'use strict';

/**
 * services/report_service.js
 *
 * 目的:
 * - 週報 / 月報のたたき台文を共通生成する
 * - 既存のレポート機能へ後で接続しやすい形にする
 */

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildWeeklyReportDraft({
  userName = '',
  weightChangeKg = null,
  mealRecordCount = null,
  exerciseRecordCount = null,
} = {}) {
  const lines = [];
  lines.push(`${safeText(userName) || '今週'}の振り返りです。`);

  if (toNumberOrNull(weightChangeKg) !== null) {
    const diff = toNumberOrNull(weightChangeKg);
    if (diff < 0) lines.push(`体重は先週より ${Math.abs(diff)}kg 下がりました。`);
    else if (diff > 0) lines.push(`体重は先週より ${diff}kg 上がりました。`);
    else lines.push('体重は大きな変化なく推移しています。');
  }

  if (toNumberOrNull(mealRecordCount) !== null) {
    lines.push(`食事記録は ${mealRecordCount}件 たまりました。`);
  }

  if (toNumberOrNull(exerciseRecordCount) !== null) {
    lines.push(`運動記録は ${exerciseRecordCount}件 たまりました。`);
  }

  lines.push('無理なく続けられている点を大事にしながら、次の1週間も整えていきましょう。');
  return lines.join('\n');
}

function buildMonthlyReportDraft({
  userName = '',
  monthLabel = '',
  totalWeightChangeKg = null,
  highlight = '',
} = {}) {
  const lines = [];
  lines.push(`${safeText(monthLabel) || '今月'}の振り返りです。`);

  if (toNumberOrNull(totalWeightChangeKg) !== null) {
    const diff = toNumberOrNull(totalWeightChangeKg);
    if (diff < 0) lines.push(`体重は月初より ${Math.abs(diff)}kg 下がりました。`);
    else if (diff > 0) lines.push(`体重は月初より ${diff}kg 上がりました。`);
    else lines.push('体重は大きな変化なく推移しました。');
  }

  if (safeText(highlight)) {
    lines.push(`今月のポイント: ${safeText(highlight)}`);
  }

  lines.push(`${safeText(userName) || 'あなた'}らしいペースを崩さず、来月につなげていきましょう。`);
  return lines.join('\n');
}

module.exports = {
  buildWeeklyReportDraft,
  buildMonthlyReportDraft,
};
