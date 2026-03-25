'use strict';

function safeText(v, f = '') { return String(v || f).trim(); }
function toNumberOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function buildQuickChartUrl(config) {
  return `https://quickchart.io/chart?width=1000&height=600&devicePixelRatio=2&format=png&backgroundColor=white&c=${encodeURIComponent(JSON.stringify(config))}`;
}
function buildImageMessage(url) { return { type: 'image', originalContentUrl: url, previewImageUrl: url }; }
function formatDateLabel(value) {
  const raw = safeText(value);
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${Number(m[2])}/${Number(m[3])}`;
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return `${d.getMonth() + 1}/${d.getDate()}`;
  return raw.slice(0, 5);
}
function compact(labels = [], values = [], maxPoints = 12) {
  if (labels.length <= maxPoints) return { labels, values };
  const nextLabels = []; const nextValues = [];
  const step = (labels.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) { const idx = Math.round(i * step); nextLabels.push(labels[idx]); nextValues.push(values[idx]); }
  return { labels: nextLabels, values: nextValues };
}
function buildLineChart(title, labels, values, label) {
  const compacted = compact(labels, values, 14);
  const min = Math.min(...compacted.values); const max = Math.max(...compacted.values);
  const pad = Math.max(1, Math.ceil((max - min || 1) * 0.25));
  return buildImageMessage(buildQuickChartUrl({
    type: 'line',
    data: { labels: compacted.labels, datasets: [{ label, data: compacted.values, borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.12)', fill: true, tension: 0.25 }] },
    options: { plugins: { title: { display: true, text: title } }, scales: { yAxes: [{ ticks: { suggestedMin: Math.floor(min - pad), suggestedMax: Math.ceil(max + pad) } }] } },
  }));
}
function buildWeightChartMessages(rows = []) {
  const points = (Array.isArray(rows) ? rows : []).map((row) => ({ label: formatDateLabel(row.logged_at || row.date), value: toNumberOrNull(row.weight_kg || row.weight) })).filter((x) => x.value != null);
  if (!points.length) return [];
  return [buildLineChart('体重グラフ', points.map((x) => x.label), points.map((x) => x.value), '体重(kg)')];
}
function buildLabMetricChartMessages(rows = [], metricKey = 'hba1c', title = '検査値グラフ', label = '値') {
  const points = (Array.isArray(rows) ? rows : []).map((row) => ({ label: formatDateLabel(row.measured_at || row.date), value: toNumberOrNull(row[metricKey]) })).filter((x) => x.value != null);
  if (!points.length) return [];
  return [buildLineChart(title, points.map((x) => x.label), points.map((x) => x.value), label)];
}

module.exports = { buildWeightChartMessages, buildLabMetricChartMessages };
