'use strict';

/**
 * services/graph_service.js
 *
 * 目的:
 * - 体重 / 食事 / 活動 / HbA1c などの見える化テキストを共通化
 * - index.js 側のグラフ呼び出し前後で使う説明文を軽く整理する
 *
 * 注意:
 * - 実際の画像生成やチャート生成ロジックは既存実装がある場合、そちらを優先
 * - 今回は見える化導線とコメント骨格をそろえる補助サービス
 */

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildGraphRequestSummary(graphType = '') {
  const t = safeText(graphType).toLowerCase();

  if (t.includes('weight') || t.includes('体重')) {
    return '体重の流れを見える化します。';
  }
  if (t.includes('meal') || t.includes('食事')) {
    return '食事の傾向を見える化します。';
  }
  if (t.includes('activity') || t.includes('運動')) {
    return '活動の流れを見える化します。';
  }
  if (t.includes('hba1c') || t.includes('血液')) {
    return '血液検査の流れを見える化します。';
  }

  return '記録の流れを見える化します。';
}

function buildWeightInsightText({ latest = null, previous = null } = {}) {
  const latestNum = toNumberOrNull(latest);
  const prevNum = toNumberOrNull(previous);

  if (latestNum === null) return '体重データがたまってくると、変化の流れが見やすくなります。';
  if (prevNum === null) return `最新の体重は ${latestNum}kg です。ここから流れを見ていきましょう。`;

  const diff = Math.round((latestNum - prevNum) * 10) / 10;
  if (diff === 0) return `体重は ${latestNum}kg で大きな変化はありませんでした。`;
  if (diff < 0) return `体重は前回より ${Math.abs(diff)}kg 下がって ${latestNum}kg でした。`;
  return `体重は前回より ${diff}kg 上がって ${latestNum}kg でした。`;
}

function buildMealInsightText({ averageKcal = null } = {}) {
  const kcal = toNumberOrNull(averageKcal);
  if (kcal === null) return '食事記録が増えるほど、食事の傾向が見やすくなります。';
  return `最近の食事は、1回あたり平均 ${kcal} kcal 前後の傾向です。`;
}

function buildActivityInsightText({ totalMinutes = null } = {}) {
  const min = toNumberOrNull(totalMinutes);
  if (min === null) return '活動記録が増えるほど、動けた日の流れが見やすくなります。';
  return `最近の活動時間は合計 ${min}分でした。`;
}

function buildLabInsightText({ latestHbA1c = null } = {}) {
  const value = toNumberOrNull(latestHbA1c);
  if (value === null) return '血液検査の記録が増えると、長い流れが見やすくなります。';
  return `最新の HbA1c は ${value} です。継続して流れを見ていきましょう。`;
}

module.exports = {
  buildGraphRequestSummary,
  buildWeightInsightText,
  buildMealInsightText,
  buildActivityInsightText,
  buildLabInsightText,
};
