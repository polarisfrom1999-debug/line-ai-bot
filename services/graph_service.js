'use strict';

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
  return ['体重グラフ', '食事活動グラフ', 'HbA1cグラフ', 'LDLグラフ', '予測'];
}

function formatDateLabel(value) {
  const raw = safeText(value);
  if (!raw) return '';
  const m = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${Number(m[2])}/${Number(m[3])}`;
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return `${d.getMonth() + 1}/${d.getDate()}`;
  return raw.slice(0, 10);
}

function pickDateLabel(row = {}) {
  return formatDateLabel(pickText(row, ['measured_at', 'logged_at', 'logged_date', 'meal_date', 'exercise_date', 'recorded_date', 'date', 'created_at', 'taken_at']));
}

function sortRowsByDateAsc(rows = []) {
  return [...normalizeRows(rows)].sort((a, b) => {
    const ad = new Date(pickText(a, ['measured_at', 'logged_at', 'logged_date', 'meal_date', 'exercise_date', 'recorded_date', 'date', 'created_at', 'taken_at']) || 0).getTime();
    const bd = new Date(pickText(b, ['measured_at', 'logged_at', 'logged_date', 'meal_date', 'exercise_date', 'recorded_date', 'date', 'created_at', 'taken_at']) || 0).getTime();
    return ad - bd;
  });
}

function buildQuickChartUrl(config) {
  return `https://quickchart.io/chart?width=1000&height=600&devicePixelRatio=2&format=png&backgroundColor=white&c=${encodeURIComponent(JSON.stringify(config))}`;
}

function buildImageMessage(url) {
  if (!safeText(url)) return null;
  return { type: 'image', originalContentUrl: url, previewImageUrl: url };
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
    data: { labels: compacted.labels, datasets: [{ label: '体重 (kg)', data: compacted.values, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.15)', fill: true, tension: 0.25, pointRadius: 3 }] },
    options: { plugins: { title: { display: true, text: '体重グラフ' }, legend: { display: true } }, scales: { yAxes: [{ ticks: { suggestedMin: Math.floor(min - padding), suggestedMax: Math.ceil(max + padding) } }] } },
  });
  const message = buildImageMessage(url);
  return message ? [message] : [];
}

function buildEnergyChartMessages(rows = []) {
  const sorted = sortRowsByDateAsc(rows);
  const labels = [];
  const kcalValues = [];
  const activityValues = [];
  for (const row of sorted) {
    labels.push(pickDateLabel(row) || `${labels.length + 1}`);
    kcalValues.push(pickNumber(row, ['meal_kcal', 'estimated_kcal', 'intake_kcal', 'calories_in', 'kcal_in']) || 0);
    activityValues.push(pickNumber(row, ['activity_kcal', 'estimated_activity_kcal', 'activity_minutes', 'minutes', 'duration_minutes']) || 0);
  }
  if (!labels.length) return [];
  const compacted = compactSeries(labels, kcalValues, 12);
  const compactedAct = compactSeries(labels, activityValues, 12);
  const url = buildQuickChartUrl({
    type: 'bar',
    data: { labels: compacted.labels, datasets: [
      { type: 'bar', label: '食事 kcal', data: compacted.values, backgroundColor: 'rgba(245,158,11,0.65)', borderColor: '#f59e0b', borderWidth: 1, yAxisID: 'y1' },
      { type: 'line', label: '活動', data: compactedAct.values, borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.12)', fill: false, tension: 0.25, pointRadius: 3, yAxisID: 'y2' },
    ] },
    options: { plugins: { title: { display: true, text: '食事活動グラフ' }, legend: { display: true } }, scales: { yAxes: [{ id: 'y1', position: 'left', ticks: { beginAtZero: true } }, { id: 'y2', position: 'right', ticks: { beginAtZero: true }, gridLines: { drawOnChartArea: false } }] } },
  });
  const message = buildImageMessage(url);
  return message ? [message] : [];
}

function extractLabSeriesValue(row = {}, field = 'hba1c') {
  const key = safeText(field).toLowerCase();
  if (key === 'ldl') return pickNumber(row, ['ldl', 'ldl_cholesterol', 'ldl_value']);
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
    data: { labels: compacted.labels, datasets: [
      { label, data: compacted.values, borderColor: key === 'ldl' ? '#9333ea' : '#dc2626', backgroundColor: key === 'ldl' ? 'rgba(147,51,234,0.12)' : 'rgba(220,38,38,0.12)', fill: true, tension: 0.2, pointRadius: 3 },
      { label: key === 'ldl' ? '目安 120' : '目安 5.6', data: targetLine, borderColor: '#6b7280', borderDash: [5, 5], fill: false, pointRadius: 0 },
    ] },
    options: { plugins: { title: { display: true, text: `${label}グラフ` }, legend: { display: true } }, scales: { yAxes: [{ ticks: { suggestedMin: Math.max(0, Math.floor((min - padding) * 10) / 10), suggestedMax: Math.ceil((max + padding) * 10) / 10 } }] } },
  });
  const message = buildImageMessage(url);
  return message ? [message] : [];
}

function buildWeightGraphMessage(rows = []) {
  const normalized = normalizeRows(rows);
  const sorted = [...normalized].sort((a,b)=> new Date(pickText(b,['measured_at','logged_at','date','created_at'])||0)-new Date(pickText(a,['measured_at','logged_at','date','created_at'])||0));
  const latest = sorted[0] ? pickNumber(sorted[0], ['weight_kg', 'weight', 'value']) : null;
  const previous = sorted[1] ? pickNumber(sorted[1], ['weight_kg', 'weight', 'value']) : null;
  let text = 'まだ体重記録が少ないので、数回たまると流れが見やすくなります。';
  if (latest != null && previous == null) text = `体重グラフです。最新は ${latest}kg でした。`;
  if (latest != null && previous != null) {
    const diff = Math.round((latest - previous) * 10) / 10;
    text = diff === 0 ? `体重グラフです。最新は ${latest}kg で、大きな変化はありませんでした。` : diff < 0 ? `体重グラフです。最新は ${latest}kg で、前回より ${Math.abs(diff)}kg 下がっていました。` : `体重グラフです。最新は ${latest}kg で、前回より ${diff}kg 上がっていました。`;
  }
  return { text, messages: buildWeightChartMessages(normalized) };
}

function buildEnergyGraphMessage(rows = []) {
  const normalized = normalizeRows(rows);
  let text = '食事と活動の記録が増えるほど、流れが見やすくなります。';
  if (normalized.length) text = '食事と活動の流れです。偏りや波を見ながら整えていきましょう。';
  return { text, messages: buildEnergyChartMessages(normalized) };
}

function buildLabGraphMessage(rows = [], field = 'hba1c') {
  const normalized = normalizeRows(rows);
  const latestRow = [...normalized].sort((a,b)=> new Date(b.measured_at||0)-new Date(a.measured_at||0))[0] || null;
  const latestValue = latestRow ? extractLabSeriesValue(latestRow, field) : null;
  const label = safeText(field).toLowerCase() === 'ldl' ? 'LDL' : 'HbA1c';
  const text = latestValue == null ? `${label}の記録がまだ少ないので、保存されたら流れを見やすく返します。` : `${label}です。最新は ${latestValue} でした。流れも一緒に見ますね。`;
  return { text, messages: buildLabChartMessages(normalized, field) };
}

module.exports = {
  buildGraphMenuQuickReplies,
  buildWeightGraphMessage,
  buildEnergyGraphMessage,
  buildLabGraphMessage,
};
