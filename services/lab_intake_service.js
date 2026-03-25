'use strict';

const { genAI, extractGeminiText, safeJsonParse, retry } = require('./gemini_service');
const { getEnv } = require('../config/env');
const { supabase } = require('./supabase_service');
const { safeText, toNumberOrNull, fmt } = require('../utils/formatters');

const env = getEnv();

const LAB_SCHEMA = {
  type: 'object',
  properties: {
    dates: {
      type: 'array',
      items: { type: 'string' },
    },
    panels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          hba1c: { type: 'number' },
          fasting_glucose: { type: 'number' },
          ldl: { type: 'number' },
          hdl: { type: 'number' },
          triglycerides: { type: 'number' },
          ast: { type: 'number' },
          alt: { type: 'number' },
          ggt: { type: 'number' },
          uric_acid: { type: 'number' },
          creatinine: { type: 'number' },
        },
        required: ['date'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['dates', 'panels', 'summary'],
};

function buildLabPrompt() {
  return [
    'あなたは血液検査画像を表形式で読み取るアシスタントです。',
    '複数日付が並んでいる場合は、すべての日付列をできるだけ抽出してください。',
    '各日付ごとに、HbA1c, fasting_glucose, LDL, HDL, triglycerides, AST, ALT, GGT, uric_acid, creatinine を拾ってください。',
    '日付は YYYY-MM-DD 形式を優先してください。',
    '不明な値は省略または null にしてください。',
    '必ず JSON だけを返してください。',
  ].join('\n');
}

async function extractBloodPanelsFromImage(buffer, mimeType) {
  const imagePart = {
    inlineData: {
      mimeType,
      data: buffer.toString('base64'),
    },
  };

  const response = await retry(async () => genAI.models.generateContent({
    model: env.GEMINI_MODEL || env.GEMINI_FALLBACK_MODEL,
    contents: [{ role: 'user', parts: [{ text: buildLabPrompt() }, imagePart] }],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: LAB_SCHEMA,
      temperature: 0.1,
    },
  }), 2, 700);

  const parsed = safeJsonParse(extractGeminiText(response));
  const panels = Array.isArray(parsed?.panels) ? parsed.panels : [];
  const normalized = panels.map((panel) => ({
    date: safeText(panel?.date, 20),
    hba1c: toNumberOrNull(panel?.hba1c),
    fasting_glucose: toNumberOrNull(panel?.fasting_glucose),
    ldl: toNumberOrNull(panel?.ldl),
    hdl: toNumberOrNull(panel?.hdl),
    triglycerides: toNumberOrNull(panel?.triglycerides),
    ast: toNumberOrNull(panel?.ast),
    alt: toNumberOrNull(panel?.alt),
    ggt: toNumberOrNull(panel?.ggt),
    uric_acid: toNumberOrNull(panel?.uric_acid),
    creatinine: toNumberOrNull(panel?.creatinine),
  })).filter((panel) => panel.date);

  return {
    dates: Array.isArray(parsed?.dates) ? parsed.dates.filter(Boolean) : normalized.map((x) => x.date),
    panels: normalized,
    summary: safeText(parsed?.summary || '血液検査を整理しました。', 300),
  };
}

async function saveBloodPanels(userId, extraction = {}) {
  const panels = Array.isArray(extraction?.panels) ? extraction.panels : [];
  const rows = [];
  for (const panel of panels) {
    const measuredAt = `${panel.date}T09:00:00+09:00`;
    const insertPayload = {
      user_id: userId,
      measured_at: measuredAt,
      hba1c: panel.hba1c,
      fasting_glucose: panel.fasting_glucose,
      ldl: panel.ldl,
      hdl: panel.hdl,
      triglycerides: panel.triglycerides,
      ast: panel.ast,
      alt: panel.alt,
      ggt: panel.ggt,
      uric_acid: panel.uric_acid,
      creatinine: panel.creatinine,
      raw_model_json: panel,
    };
    const { error } = await supabase.from('lab_results').insert(insertPayload);
    if (!error) rows.push(insertPayload);
  }
  return rows;
}

async function getRecentLabRows(userId, limit = 12) {
  const { data, error } = await supabase
    .from('lab_results')
    .select('*')
    .eq('user_id', userId)
    .order('measured_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

function buildSavedLabReply(savedRows = []) {
  if (!savedRows.length) {
    return '血液検査の読み取りはできましたが、保存で少し詰まっています。もう一度送っても大丈夫です。';
  }

  const latest = savedRows[0];
  const lines = [
    `血液検査を整理しました。${savedRows.length}件ぶん保存できています。`,
    latest?.hba1c != null ? `最新の HbA1c: ${fmt(latest.hba1c)}` : null,
    latest?.ldl != null ? `最新の LDL: ${fmt(latest.ldl)}` : null,
    '続けて「HbA1cグラフ」「LDLグラフ」「HbA1cは？」のように送れます。',
  ].filter(Boolean);

  return lines.join('\n');
}

function buildLabAnswer(rows = [], field = 'hba1c') {
  const latest = (rows || []).find((row) => row && row[field] != null);
  if (!latest) {
    const label = field === 'ldl' ? 'LDL' : 'HbA1c';
    return `${label}は、まだ保存できている記録が少ないようです。画像を送ってもらえたら整理します。`;
  }

  const label = field === 'ldl' ? 'LDL' : field === 'hdl' ? 'HDL' : field === 'triglycerides' ? '中性脂肪' : 'HbA1c';
  return `${label}の最新は ${fmt(latest[field])} です。測定日は ${String(latest.measured_at || '').slice(0, 10)} でした。`;
}

module.exports = {
  extractBloodPanelsFromImage,
  saveBloodPanels,
  getRecentLabRows,
  buildSavedLabReply,
  buildLabAnswer,
};
