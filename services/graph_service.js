'use strict';

/**
 * services/graph_service.js
 *
 * 目的:
 * - 体重 / 食事活動 / HbA1c / LDL / 血液検査 のグラフ画像を返す
 * - LINE にそのまま送れる image message を作る
 * - データが少ない時も落ちずにテキスト + 画像の両方を返す
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
    return '体重の流れを見やすくまとめます。';
  }
  if (t.includes('meal') || t.includes('food') || t.includes('energy') || t.includes('食事') || t.includes('活動') || t.includes('運動')) {
    return '食事と活動の流れを見やすくまとめます。';
  }
  if (t.includes('hba1c') || t.includes('ldl') || t.includes('lab') || t.includes('血液')) {
    return '血液検査の流れを見やすくまとめます。';
  }

  return '記録の流れを見やすくまとめます。';
}

function formatDateLabel(value) {
  const raw = safeText(value);
  if (!raw) return '';

  const m = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${Number(m[2])}/${Number(m[3])}`;

  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  return raw.slice(0, 10);
}

function pickDateLabel(row = {}) {
  return formatDateLabel(
    pickText(row, [
      'logged_date',
      'meal_date',
      'exercise_date',
      'measured_on',
      'recorded_date',
      'date',
      'created_at',
      'logged_at',
      'taken_at',
    ])
  );
}

function sortRowsByDateAsc(rows = []) {
  return [...normalizeRows(rows)].sort((a, b) => {
    const ad = new Date(
      pickText(a, ['logged_date', 'meal_date', 'exercise_date', 'measured_on', 'recorded_date', 'date', 'created_at', 'logged_at', 'taken_at']) || 0
    ).getTime();
    const bd = new Date(
      pickText(b, ['logged_date', 'meal_date', 'exercise_date', 'measured_on', 'recorded_date', 'date', 'created_at', 'logged_at', 'taken_at']) || 0
    ).getTime();
    return ad - bd;
  });
}

function buildWeightInsightText({ latest = null, previous = null } = {}) {
  const latestNum = toNumberOrNull(latest);
  const prevNum = toNumberOrNull(previous);

  if (latestNum === null) {
    return '体重グラフです。記録がたまってくるほど、流れが見やすくなります。';
  }

  if (prevNum === null) {
    return `体重グラフです。最新は ${latestNum}kg でした。`;
  }

  const diff = Math.round((latestNum - prevNum) * 10) / 10;
  if (diff === 0) {
    return `体重グラフです。最新は ${latestNum}kg で、大きな変化はありませんでした。`;
  }
  if (diff < 0) {
    return `体重グラフです。最新は ${latestNum}kg で、前回より ${Math.abs(diff)}kg 下がっていました。`;
  }
  return `体重グラフです。最新は ${latestNum}kg で、前回より ${diff}kg 上がっていました。`;
}

function buildMealInsightText({ averageKcal = null } = {}) {
  const kcal = toNumberOrNull(averageKcal);
  if (kcal === null) {
    return '食事と活動の流れです。記録が増えるほど、傾向が見やすくなります。';
  }
  return `食事と活動の流れです。最近の食事は、1回あたり平均 ${kcal} kcal 前後でした。`;
}

function buildActivityInsightText({ totalMinutes = null } = {}) {
  const min = toNumberOrNull(totalMinutes);
  if (min === null) {
    return '動けた日の波も、ここから少しずつ見やすくなります。';
  }
  return `活動時間は、今回まとまって ${min}分ぶん確認できています。`;
}

function buildLabInsightText({ latestHbA1c = null } = {}) {
  const value = toNumberOrNull(latestHbA1c);
  if (value === null) {
    return '血液検査の流れです。記録が増えるほど、変化が見やすくなります。';
  }
  return `血液検査の流れです。最新の HbA1c は ${value} でした。`;
}

function buildQuickChartUrl(config) {
  return `https://quickchart.io/chart?width=1000&height=600&devicePixelRatio=2&format=png&backgroundColor=white&c=${encodeURIComponent(JSON.stringify(config))}`;
}

function buildImageMessage(url) {
  if (!safeText(url)) return null;
  return {
    type: 'image',
    originalContentUrl: url,
    previewImageUrl: url,
  };
}

function compactSeries(labels = [], values = [], maxPoints = 12) {
  if (labels.length <= maxPoints) return { labels, values };

  const nextLabels = [];
  const nextValues = [];
  const step = (labels.length - 1) / (maxPoints - 1);

  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.round(i * step);
    nextLabels.push(labels[index]);
    nextValues.push(values[index]);
  }

  return { labels: nextLabels, values: nextValues };
}

function buildWeightChartMessages(rows = []) {
  const sorted = sortRowsByDateAsc(rows);
  const labels = [];
  const values = [];

  for (const row of sorted) {
    const value = pickNumber(row, ['weight_kg', 'weight', 'value']);
    if (value === null) continue;
    labels.push(pickDateLabel(row) || `${labels.length + 1}`);
    values.push(value);
  }

  if (!values.length) return [];

  const compacted = compactSeries(labels, values, 14);
  const min = Math.min(...compacted.values);
  const max = Math.max(...compacted.values);
  const padding = Math.max(1, Math.ceil((max - min) * 0.25));

  const url = buildQuickChartUrl({
    type: 'line',
    data: {
      labels: compacted.labels,
      datasets: [
        {
          label: '体重 (kg)',
          data: compacted.values,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37,99,235,0.15)',
          fill: true,
          tension: 0.25,
          pointRadius: 3,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: '体重グラフ' },
        legend: { display: true },
      },
      scales: {
        yAxes: [{
          ticks: {
            suggestedMin: Math.floor(min - padding),
            suggestedMax: Math.ceil(max + padding),
          },
        }],
      },
    },
  });

  const message = buildImageMessage(url);
  return message ? [message] : [];
}

function buildEnergyChartMessages(rows = []) {
  const sorted = sortRowsByDateAsc(rows);
  const labels = [];
  const kcalValues = [];
  const minutesValues = [];

  for (const row of sorted) {
    const kcal = pickNumber(row, [
      'meal_kcal',
      'estimated_kcal',
      'intake_kcal',
      'calories_in',
      'kcal_in',
    ]);
    const minutes = pickNumber(row, [
      'exercise_minutes',
      'activity_minutes',
      'minutes',
      'duration_minutes',
    ]);

    labels.push(pickDateLabel(row) || `${labels.length + 1}`);
    kcalValues.push(kcal !== null ? kcal : 0);
    minutesValues.push(minutes !== null ? minutes : 0);
  }

  if (!labels.length) return [];

  const compacted = compactSeries(labels, kcalValues, 12);
  const compactedMinutes = compactSeries(labels, minutesValues, 12);

  const url = buildQuickChartUrl({
    type: 'bar',
    data: {
      labels: compacted.labels,
      datasets: [
        {
          type: 'bar',
          label: '食事 kcal',
          data: compacted.values,
          backgroundColor: 'rgba(245,158,11,0.65)',
          borderColor: '#f59e0b',
          borderWidth: 1,
          yAxisID: 'y1',
        },
        {
          type: 'line',
          label: '活動 分',
          data: compactedMinutes.values,
          borderColor: '#16a34a',
          backgroundColor: 'rgba(22,163,74,0.12)',
          fill: false,
          tension: 0.25,
          pointRadius: 3,
          yAxisID: 'y2',
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: '食事活動グラフ' },
        legend: { display: true },
      },
      scales: {
        yAxes: [
          {
            id: 'y1',
            position: 'left',
            ticks: { beginAtZero: true },
          },
          {
            id: 'y2',
            position: 'right',
            ticks: { beginAtZero: true },
            gridLines: { drawOnChartArea: false },
          },
        ],
      },
    },
  });

  const message = buildImageMessage(url);
  return message ? [message] : [];
}

function extractLabSeriesValue(row = {}, field = 'hba1c') {
  const key = safeText(field).toLowerCase();
  if (key === 'ldl') {
    return pickNumber(row, ['ldl', 'ldl_cholesterol', 'ldl_value']);
  }
  return pickNumber(row, ['hba1c', 'hb_a1c', 'hb1ac']);
}

function buildLabChartMessages(rows = [], field = 'hba1c') {
  const sorted = sortRowsByDateAsc(rows);
  const labels = [];
  const values = [];
  const key = safeText(field).toLowerCase();
  const label = key === 'ldl' ? 'LDL' : 'HbA1c';
  const targetValue = key === 'ldl' ? 120 : 5.6;

  for (const row of sorted) {
    const value = extractLabSeriesValue(row, field);
    if (value === null) continue;
    labels.push(pickDateLabel(row) || `${labels.length + 1}`);
    values.push(value);
  }

  if (!values.length) return [];

  const compacted = compactSeries(labels, values, 12);
  const targetLine = new Array(compacted.values.length).fill(targetValue);
  const min = Math.min(...compacted.values, targetValue);
  const max = Math.max(...compacted.values, targetValue);
  const padding = Math.max(key === 'ldl' ? 5 : 0.1, (max - min) * 0.2);

  const url = buildQuickChartUrl({
    type: 'line',
    data: {
      labels: compacted.labels,
      datasets: [
        {
          label,
          data: compacted.values,
          borderColor: key === 'ldl' ? '#9333ea' : '#dc2626',
          backgroundColor: key === 'ldl' ? 'rgba(147,51,234,0.12)' : 'rgba(220,38,38,0.12)',
          fill: true,
          tension: 0.2,
          pointRadius: 3,
        },
        {
          label: key === 'ldl' ? '目安 120' : '目安 5.6',
          data: targetLine,
          borderColor: '#6b7280',
          borderDash: [5, 5],
          fill: false,
          pointRadius: 0,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: `${label}グラフ` },
        legend: { display: true },
      },
      scales: {
        yAxes: [{
          ticks: {
            suggestedMin: Math.max(0, Math.floor((min - padding) * 10) / 10),
            suggestedMax: Math.ceil((max + padding) * 10) / 10,
          },
        }],
      },
    },
  });

  const message = buildImageMessage(url);
  return message ? [message] : [];
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

  let text = buildWeightInsightText({ latest, previous });
  if (!normalized.length) {
    text = 'まだ体重記録が少ないので、数回たまると流れが見やすくなります。';
  }

  return {
    text,
    messages: buildWeightChartMessages(normalized),
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
    messages: buildEnergyChartMessages(normalized),
  };
}

function buildLabGraphMessage(rows = [], field = 'hba1c') {
  const normalized = normalizeRows(rows);
  const latestRow = normalized[0] || normalized[normalized.length - 1] || null;
  const latestValue = latestRow ? extractLabSeriesValue(latestRow, field) : null;
  const label = safeText(field).toLowerCase() === 'ldl' ? 'LDL' : 'HbA1c';

  let text = '';
  if (latestValue === null) {
    text = `${label}グラフです。記録が増えるほど、変化が見やすくなります。`;
  } else {
    text = `${label}グラフです。最新は ${latestValue} でした。流れを見ながら整えていきましょう。`;
  }

  return {
    text,
    messages: buildLabChartMessages(normalized, field),
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
