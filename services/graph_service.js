'use strict';

const { supabase } = require('./supabase_service');
const { fmt } = require('../utils/formatters');

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function pickDate(row = {}) {
  return row.logged_at || row.measured_at || row.eaten_at || row.created_at || row.date || null;
}

function sortRows(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => new Date(pickDate(a) || 0) - new Date(pickDate(b) || 0));
}

function dateLabel(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return safeText(value).slice(5, 10);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function chartUrl(config) {
  return `https://quickchart.io/chart?width=1000&height=600&devicePixelRatio=2&format=png&backgroundColor=white&c=${encodeURIComponent(JSON.stringify(config))}`;
}

function imageMessage(url) {
  return { type: 'image', originalContentUrl: url, previewImageUrl: url };
}

async function getWeightRows(userId) {
  const { data, error } = await supabase.from('weight_logs').select('*').eq('user_id', userId).limit(100);
  if (error) throw error;
  return sortRows(data || []);
}

async function getLabRows(userId) {
  const { data, error } = await supabase.from('lab_results').select('*').eq('user_id', userId).limit(100);
  if (error) throw error;
  return sortRows(data || []);
}

async function getMealRowsToday(userId, startIso, endIso) {
  const { data, error } = await supabase
    .from('meal_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('eaten_at', startIso)
    .lte('eaten_at', endIso);
  if (error) throw error;
  return data || [];
}

async function getActivityRowsToday(userId, startIso, endIso) {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('logged_at', startIso)
    .lte('logged_at', endIso);
  if (error) throw error;
  return data || [];
}

function buildLineChart(title, labels, values, datasetLabel) {
  const url = chartUrl({
    type: 'line',
    data: { labels, datasets: [{ label: datasetLabel, data: values, borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.12)', fill: true, tension: 0.2 }] },
    options: { plugins: { title: { display: true, text: title } } },
  });
  return imageMessage(url);
}

async function replyGraphIntent(user, text = '') {
  const raw = safeText(text).toLowerCase();
  if (raw.includes('hba1c')) {
    const rows = await getLabRows(user.id);
    const filtered = rows.filter((row) => Number.isFinite(Number(row.hba1c)));
    if (!filtered.length) return { text: 'HbA1cの記録がまだ少ないので、保存されたら流れを見やすく返します。', messages: [] };
    const labels = filtered.map((row) => dateLabel(pickDate(row)));
    const values = filtered.map((row) => Number(row.hba1c));
    return { text: 'HbA1cの流れです。', messages: [buildLineChart('HbA1cグラフ', labels, values, 'HbA1c')] };
  }
  if (raw.includes('ldl')) {
    const rows = await getLabRows(user.id);
    const filtered = rows.filter((row) => Number.isFinite(Number(row.ldl)));
    if (!filtered.length) return { text: 'LDLの記録がまだ少ないので、保存されたら流れを見やすく返します。', messages: [] };
    const labels = filtered.map((row) => dateLabel(pickDate(row)));
    const values = filtered.map((row) => Number(row.ldl));
    return { text: 'LDLの流れです。', messages: [buildLineChart('LDLグラフ', labels, values, 'LDL')] };
  }
  const rows = await getWeightRows(user.id);
  const filtered = rows.filter((row) => Number.isFinite(Number(row.weight_kg)));
  if (!filtered.length) return { text: 'まだ体重記録が少ないので、数回たまると流れが見やすくなります。', messages: [] };
  const labels = filtered.map((row) => dateLabel(pickDate(row)));
  const values = filtered.map((row) => Number(row.weight_kg));
  return { text: '体重グラフです。', messages: [buildLineChart('体重グラフ', labels, values, '体重(kg)')] };
}

async function replyLatestLabMetric(user, metric = '') {
  const rows = await getLabRows(user.id);
  const key = String(metric || '').toLowerCase().includes('ldl') ? 'ldl' : 'hba1c';
  const label = key === 'ldl' ? 'LDL' : 'HbA1c';
  const filtered = rows.filter((row) => Number.isFinite(Number(row[key])));
  if (!filtered.length) return `${label}の記録がまだ見つからないので、保存されたら返しますね。`;
  const latest = filtered[filtered.length - 1];
  return `最新の${label}は ${fmt(latest[key])} です。流れを見るなら「${label}グラフ」でも大丈夫です。`;
}

module.exports = {
  replyGraphIntent,
  replyLatestLabMetric,
  getMealRowsToday,
  getActivityRowsToday,
};
