'use strict';

/**
 * services/graph_service.js
 *
 * 目的:
 * - 体重 / 食事活動 / HbA1c / LDL / 血液検査 のグラフ導線を安定化
 * - index.js から呼ばれる互換関数名をそろえる
 * - 実画像が無い場合でも、落ちずにテキスト返答できるようにする
 *
 * 注意:
 * - ここでは「落ちないこと」と「自然な返答」を優先
 * - 実際の画像生成ロジックが別にある場合は、後でこのファイルに接続していけば大丈夫です
 */

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickNumber(row = {}, keys = []) {
  for (const key of keys) {
    const value = toNumberOrNull(row?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function pickText(row = {}, keys = []) {
  for (const key of keys) {
    const value = safeText(row?.[key]);
    if (value) return value;
  }
  return '';
}

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows.filter(Boolean) : [];
}

function buildGraphMenuQuickReplies() {
  return ['体重グラフ', '食事活動グラフ', 'HbA1cグラフ', 'LDLグラフ'];
}

function buildGraphRequestSummary(graphType = '') {
  const t = safeText(graphType).toLowerCase();

  if (t.includes('weight') || t.includes('体重')) {
    return '体重の流れを見える化します。';
  }
  if (t.includes('meal') || t.includes('food') || t.includes('energy') || t.includes('食事') || t.includes('活動') || t.includes('運動')) {
    return '食事と活動の流れを見える化します。';
  }
  if (t.includes('hba1c') || t.includes('ldl') || t.includes('lab') || t.includes('血液')) {
    return '血液検査の流れを見える化します。';
  }

  return '記録の流れを見える化します。';
}

function buildWeightInsightText({ latest = null, previous = null } = {}) {
  const latestNum = toNumberOrNull(latest);
  const prevNum = toNumberOrNull(previous);

  if (latestNum === null) {
    return '体重データがたまってくると、変化の流れが見やすくなります。';
  }

  if (prevNum === null) {
    return `最新の体重は ${latestNum}kg です。ここから流れを見ていきましょう。`;
  }

  const diff = Math.round((latestNum - prevNum) * 10) / 10;
  if (diff === 0) {
    return `最新の体重は ${latestNum}kg で、大きな変化はありませんでした。`;
  }
  if (diff < 0) {
    return `最新の体重は ${latestNum}kg で、前回より ${Math.abs(diff)}kg 下がっていました。`;
  }
  return `最新の体重は ${latestNum}kg で、前回より ${diff}kg 上がっていました。`;
}

function buildMealInsightText({ averageKcal = null } = {}) {
  const kcal = toNumberOrNull(averageKcal);
  if (kcal === null) {
    return '食事記録が増えるほど、食事の傾向が見やすくなります。';
  }
  return `最近の食事は、1回あたり平均 ${kcal} kcal 前後の傾向です。`;
}

function buildActivityInsightText({ totalMinutes = null } = {}) {
  const min = toNumberOrNull(totalMinutes);
  if (min === null) {
    return '活動記録が増えるほど、動けた日の流れが見やすくなります。';
  }
  return `最近の活動時間は合計 ${min}分でした。`;
}

function buildLabInsightText({ latestHbA1c = null } = {}) {
  const value = toNumberOrNull(latestHbA1c);
  if (value === null) {
    return '血液検査の記録が増えると、長い流れが見やすくなります。';
  }
  return `最新の HbA1c は ${value} です。継続して流れを見ていきましょう。`;
}

function buildWeightGraphMessage(rows = []) {
  const normalized = normalizeRows(rows);
  const latestRow = normalized[0] || normalized[normalized.length - 1] || null;
  const previousRow = normalized[1] || null;

  const latest = latestRow
    ? pickNumber(latestRow, ['weight_kg', 'weight', 'value'])
    : null;
  const previous = previousRow
    ? pickNumber(previousRow, ['weight_kg', 'weight', 'value'])
    : null;

  const count = normalized.length;

  let text = buildWeightInsightText({ latest, previous });
  if (count >= 2) {
    text += `\n直近 ${count} 件の体重記録をもとに流れを見ています。`;
  } else if (count === 1) {
    text += '\nまだ記録が少ないので、これから流れが見やすくなっていきます。';
  } else {
    text = 'まだ体重記録が少ないので、最初の数回が入るとグラフが見やすくなります。';
  }

  return {
    text,
    messages: [],
  };
}

function buildEnergyGraphMessage(rows = []) {
  const normalized = normalizeRows(rows);

  const kcalValues = normalized
    .map((row) => pickNumber(row, [
      'meal_kcal',
      'estimated_kcal',
      'intake_kcal',
      'calories_in',
      'kcal_in',
    ]))
    .filter((v) => v !== null);

  const minutesValues = normalized
    .map((row) => pickNumber(row, [
      'exercise_minutes',
      'activity_minutes',
      'minutes',
      'duration_minutes',
    ]))
    .filter((v) => v !== null);

  const averageKcal = kcalValues.length
    ? Math.round(kcalValues.reduce((sum, v) => sum + v, 0) / kcalValues.length)
    : null;

  const totalMinutes = minutesValues.length
    ? Math.round(minutesValues.reduce((sum, v) => sum + v, 0))
    : null;

  const parts = [
    buildMealInsightText({ averageKcal }),
    buildActivityInsightText({ totalMinutes }),
  ].filter(Boolean);

  let text = parts.join('\n');
  if (!text) {
    text = '食事と活動の記録が増えるほど、流れが見やすくなります。';
  }

  if (!normalized.length) {
    text = 'まだ食事や活動の記録が少ないので、数日たまると見やすくなります。';
  }

  return {
    text,
    messages: [],
  };
}

function extractLabSeriesValue(row = {}, field = '') {
  const normalizedField = safeText(field).toLowerCase();

  if (normalizedField === 'hba1c') {
    return pickNumber(row, ['hba1c', 'hb_a1c', 'hemoglobin_a1c']);
  }

  if (normalizedField === 'ldl') {
    return pickNumber(row, ['ldl', 'ldl_cholesterol']);
  }

  return (
    pickNumber(row, [normalizedField]) ??
    pickNumber(row, ['hba1c', 'hb_a1c', 'ldl'])
  );
}

function buildLabGraphMessage(rows = [], field = 'hba1c') {
  const normalized = normalizeRows(rows);
  const latestRow = normalized[0] || normalized[normalized.length - 1] || null;
  const latestValue = latestRow ? extractLabSeriesValue(latestRow, field) : null;
  const label = safeText(field).toLowerCase() === 'ldl' ? 'LDL' : 'HbA1c';

  let text = '';
  if (latestValue === null) {
    text = `${label} の記録が増えると、流れが見やすくなります。`;
  } else {
    text = `最新の ${label} は ${latestValue} です。流れを見ながら整えていきましょう。`;
  }

  if (normalized.length >= 2) {
    text += `\n直近 ${normalized.length} 件の血液検査記録をもとに見ています。`;
  }

  return {
    text,
    messages: [],
  };
}

module.exports = {
  buildGraphRequestSummary,
  buildWeightInsightText,
  buildMealInsightText,
  buildActivityInsightText,
  buildLabInsightText,
  buildGraphMenuQuickReplies,
  buildWeightGraphMessage,
  buildEnergyGraphMessage,
  buildLabGraphMessage,
};
