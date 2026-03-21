'use strict';

/**
 * services/graph_service.js
 *
 * 目的:
 * - 体重 / 食事活動 / HbA1c / LDL / 血液検査 のグラフ画像を返す
 * - LINE にそのまま送れる image message を作る
 * - データが少ない時も落ちずにテキスト + 画像の両方を返す
 *
 * 方針:
 * - まずは確実に画像を出すことを優先し、QuickChart の URL 画像を使う
 * - index.js 側は graph.messages をそのまま reply しているため、このファイル差し替えで反映できる
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

    if (kcal === null && minutes === null) continue;

    labels.push(pickDateLabel(row) || `${labels.length + 1}`);
    kcalValues.push(kcal === null ? null : kcal);
    minutesValues.push(minutes === null ? null : minutes);
  }

  if (!labels.length) return [];

  const compacted = compactSeries(labels, kcalValues, 10);
  const minutesCompacted = compactSeries(labels, minutesValues, 10);

  const url = buildQuickChartUrl({
    type: 'bar',
    data: {
      labels: compacted.labels,
      datasets: [
        {
          type: 'bar',
          label: '食事 kcal',
          data: compacted.values,
          backgroundColor: 'rgba(249,115,22,0.6)',
          borderColor: '#f97316',
          yAxisID: 'y1',
        },
        {
          type: 'line',
          label: '活動 分',
          data: minutesCompacted.values,
          borderColor: '#16a34a',
          backgroundColor: 'rgba(22,163,74,0.15)',
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
            scaleLabel: { display: true, labelString: 'kcal' },
          },
          {
            id: 'y2',
            position: 'right',
            ticks: { beginAtZero: true },
            scaleLabel: { display: true, labelString: '分' },
            gridLines: { drawOnChartArea: false },
          },
        ],
      },
    },
  });

  const message = buildImageMessage(url);
  return message ? [message] : [];
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

function buildLabChartMessages(rows = [], field = 'hba1c') {
  const sorted = sortRowsByDateAsc(rows);
  const labels = [];
  const values = [];
  const normalizedField = safeText(field).toLowerCase() === 'ldl' ? 'ldl' : 'hba1c';
  const label = normalizedField === 'ldl' ? 'LDL' : 'HbA1c';

  for (const row of sorted) {
    const value = extractLabSeriesValue(row, normalizedField);
    if (value === null) continue;
    labels.push(pickDateLabel(row) || `${labels.length + 1}`);
    values.push(value);
  }

  if (!values.length) return [];

  const compacted = compactSeries(labels, values, 12);
  const targetValue = normalizedField === 'ldl' ? 120 : 5.6;

  const url = buildQuickChartUrl({
    type: 'line',
    data: {
      labels: compacted.labels,
      datasets: [
        {
          label,
          data: compacted.values,
          borderColor: normalizedField === 'ldl' ? '#7c3aed' : '#dc2626',
          backgroundColor: normalizedField === 'ldl'
            ? 'rgba(124,58,237,0.15)'
            : 'rgba(220,38,38,0.15)',
          fill: true,
          tension: 0.25,
          pointRadius: 3,
        },
        {
          label: normalizedField === 'ldl' ? '目安線 120' : '目安線 5.6',
          data: compacted.labels.map(() => targetValue),
          borderColor: '#6b7280',
          borderDash: [6, 6],
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
        yAxes: [{ ticks: { beginAtZero: false } }],
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
    text = `${label} の記録が増えると、流れが見やすくなります。`;
  } else {
    text = `最新の ${label} は ${latestValue} です。流れを見ながら整えていきましょう。`;
  }

  if (normalized.length >= 2) {
    text += `\n直近 ${normalized.length} 件の血液検査記録をもとに見ています。`;
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
