'use strict';

/**
 * services/lab_image_analysis_service.js
 *
 * Phase 7:
 * - 血液検査の「帳票日」と「検査日」を分離
 * - 単日表 / 複数日表の両方を扱う
 * - 日付ごとの主要項目をまとめて保持
 * - TG / HbA1c / LDL / HDL / AST / ALT / γ-GTP の follow-up と傾向要約を返しやすくする
 */

const METRIC_DEFS = [
  { key: 'tg', label: 'TG（中性脂肪）', aliases: ['TG', '中性脂肪', 'トリグリセリド'] },
  { key: 'hba1c', label: 'HbA1c', aliases: ['HbA1c', 'HBA1C', 'HbA1c(NGSP)', 'HbA1c（NGSP）'] },
  { key: 'ldl', label: 'LDL', aliases: ['LDL', 'LDLコレステロール', 'LDL-コレステロール', 'LDL(LDLコレステロール)'] },
  { key: 'hdl', label: 'HDL', aliases: ['HDL', 'HDLコレステロール', 'HDL-コレステロール', 'HDL(HDLコレステロール)'] },
  { key: 'ast', label: 'AST', aliases: ['AST', 'GOT', 'GOT(AST)'] },
  { key: 'alt', label: 'ALT', aliases: ['ALT', 'GPT', 'GPT(ALT)'] },
  { key: 'ggt', label: 'γ-GTP', aliases: ['γ-GTP', 'γGTP', 'γｰGTP', 'GGT', 'y-GTP', 'γ-GTP'] },
];

const FOLLOWUP_METRIC_MAP = {
  'tg': 'tg',
  '中性脂肪': 'tg',
  'トリグリセリド': 'tg',
  'hba1c': 'hba1c',
  'ldl': 'ldl',
  'hdl': 'hdl',
  'ast': 'ast',
  'alt': 'alt',
  'γ-gtp': 'ggt',
  'γgtp': 'ggt',
  'ggt': 'ggt',
  'y-gtp': 'ggt',
};

function compactText(input) {
  return String(input || '')
    .replace(/\r/g, '\n')
    .replace(/[\u3000\t]+/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function pad2(v) {
  return String(v).padStart(2, '0');
}

function normalizeDateParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || !m || !d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function normalizeEraDate(era, yy, mm, dd) {
  const e = String(era || '').toUpperCase();
  const year = Number(yy);
  if (!year) return null;
  let base = null;
  if (e === 'R') base = 2018; // Reiwa 1 => 2019
  if (e === 'H') base = 1988; // Heisei 1 => 1989
  if (!base) return null;
  return normalizeDateParts(base + year, mm, dd);
}

function normalizeDateToken(token) {
  if (!token) return null;
  const raw = String(token).trim();

  let m = raw.match(/^([RrHh])\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) return normalizeEraDate(m[1], m[2], m[3], m[4]);

  m = raw.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) return normalizeDateParts(m[1], m[2], m[3]);

  m = raw.match(/^(\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) {
    const yy = Number(m[1]);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    return normalizeDateParts(yyyy, m[2], m[3]);
  }

  m = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return normalizeDateParts(m[1], m[2], m[3]);

  m = raw.match(/^([RrHh])(\d{1,2})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return normalizeEraDate(m[1], m[2], m[3], m[4]);

  return null;
}

function findAllDateTokens(text) {
  const source = compactText(text);
  if (!source) return [];

  const regex = /([RrHh]\s*\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{2}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日|[RrHh]\d{1,2}年\d{1,2}月\d{1,2}日)/g;
  const out = [];
  let match;
  while ((match = regex.exec(source))) {
    const d = normalizeDateToken(match[1]);
    if (d) out.push(d);
  }
  return uniq(out);
}

function parseIssuedDate(text) {
  const source = compactText(text);
  const patterns = [
    /(?:印刷日|作成日|報告日|作成)[:：]?\s*([RrHh]\s*\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日)/,
  ];
  for (const pattern of patterns) {
    const m = source.match(pattern);
    if (m) {
      const d = normalizeDateToken(m[1]);
      if (d) return d;
    }
  }
  return null;
}

function parseExamDatesByLabel(text) {
  const source = compactText(text);
  const dates = [];
  const patterns = [
    /(?:検査年月日|検査日|採血日|採取日|受診日)[:：]?\s*([RrHh]\s*\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日)/g,
  ];
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(source))) {
      const d = normalizeDateToken(m[1]);
      if (d) dates.push(d);
    }
  }
  return uniq(dates);
}

function looksLikePanelDateLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  const dates = findAllDateTokens(trimmed);
  if (dates.length >= 2) return true;
  if (/基準値/.test(trimmed) && dates.length >= 1) return true;
  if (/正準値|検査項目/.test(trimmed) && dates.length >= 1) return true;
  return false;
}

function extractPanelDates(text) {
  const source = compactText(text);
  const issuedDate = parseIssuedDate(source);
  const labeledExamDates = parseExamDatesByLabel(source);
  const lines = source.split('\n').map((s) => s.trim()).filter(Boolean);

  let candidates = [];
  for (const line of lines) {
    if (looksLikePanelDateLine(line)) {
      candidates.push(...findAllDateTokens(line));
    }
  }

  if (!candidates.length) {
    candidates.push(...labeledExamDates);
  }
  if (!candidates.length) {
    candidates.push(...findAllDateTokens(source));
  }

  candidates = uniq(candidates).filter((d) => d && d !== issuedDate);
  candidates.sort();

  if (!candidates.length && labeledExamDates.length) {
    candidates = labeledExamDates.slice().sort();
  }

  return {
    issuedDate: issuedDate || null,
    panelDates: candidates,
    labeledExamDates,
  };
}

function combinePayloadTexts(payload) {
  const parts = [
    payload && payload.matrixRawText,
    payload && payload.priorityRawText,
    payload && payload.rawText,
    payload && payload.dateRawText,
    payload && payload.text,
  ].map(compactText).filter(Boolean);
  return uniq(parts).join('\n');
}

function buildMetricRegex(metricDef) {
  const escaped = metricDef.aliases
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  return new RegExp(`(${escaped.join('|')})`, 'i');
}

function lineHasMetric(line, metricDef) {
  return buildMetricRegex(metricDef).test(line || '');
}

function stripUnitsAndRanges(line) {
  return String(line || '')
    .replace(/\b\d+(?:\.\d+)?\s*[~〜-]\s*\d+(?:\.\d+)?\b/g, ' ')
    .replace(/\b(?:mg\/dL|g\/dL|U\/L|%|mEq\/L|IU\/L|ng\/dL|pg\/mL|fL|x10|\/μL|\/ul)\b/gi, ' ')
    .replace(/[()（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeNumberCells(line) {
  const out = [];
  const regex = /(-?\d+(?:\.\d+)?)(?:\s*([HL]))?/g;
  let m;
  while ((m = regex.exec(line))) {
    out.push({ value: m[1], flag: m[2] || null, index: m.index });
  }
  return out;
}

function findMetricLineCandidates(text, metricDef) {
  const lines = compactText(text).split('\n');
  return lines.filter((line) => lineHasMetric(line, metricDef));
}

function chooseCellForDate(tokens, panelDates, targetDate) {
  if (!tokens.length) return null;
  if (!panelDates.length || panelDates.length === 1) return tokens[0];

  const idx = Math.max(0, panelDates.indexOf(targetDate));
  if (idx < tokens.length) return tokens[idx];
  if (tokens.length === panelDates.length - 1 && idx > 0 && idx - 1 < tokens.length) return tokens[idx - 1];
  return tokens[tokens.length - 1];
}

function extractMetricValueFromText(text, metricDef, panelDates, targetDate) {
  const candidates = findMetricLineCandidates(text, metricDef);
  for (const line of candidates) {
    const cleaned = stripUnitsAndRanges(line);
    const afterMetric = cleaned.replace(buildMetricRegex(metricDef), ' ').trim();
    const tokens = tokenizeNumberCells(afterMetric);
    if (!tokens.length) continue;
    const cell = chooseCellForDate(tokens, panelDates, targetDate);
    if (cell) {
      return {
        metricKey: metricDef.key,
        value: String(cell.value),
        flag: cell.flag || null,
        sourceLine: line,
      };
    }
  }
  return null;
}

function buildMetricsByDate(text, panelDates) {
  const dates = panelDates.length ? panelDates : [null];
  const byDate = {};
  for (const date of dates) {
    const key = date || 'single';
    byDate[key] = {};
    for (const metric of METRIC_DEFS) {
      const value = extractMetricValueFromText(text, metric, panelDates, date);
      if (value && value.value != null) byDate[key][metric.key] = value;
    }
  }
  return byDate;
}

function pickDefaultDate(panelDates) {
  if (!panelDates || !panelDates.length) return null;
  return panelDates.slice().sort().slice(-1)[0];
}

function detectFollowupMetric(text) {
  const s = String(text || '').toLowerCase();
  for (const [needle, metricKey] of Object.entries(FOLLOWUP_METRIC_MAP)) {
    if (s.includes(needle.toLowerCase())) return metricKey;
  }
  return null;
}

function extractDateSelection(text, panelDates) {
  const dates = findAllDateTokens(text);
  if (!dates.length) return null;
  for (const d of dates) {
    if (!panelDates || !panelDates.length || panelDates.includes(d)) return d;
  }
  return dates[0] || null;
}

function buildDateListReply(panelDates) {
  if (!panelDates || !panelDates.length) {
    return '血液検査画像は受け取りましたが、検査日がまだはっきり拾えていません。別角度の画像があると助かります。';
  }
  const bullets = panelDates.map((d) => `・${d}`).join('\n');
  return [
    '複数の日付を読み取りました。',
    bullets,
    '1日分を確認するなら日付をそのまま送ってください。',
    '今までの傾向を見たい時は「今までの傾向は？」、まとめて使う時は「読み取れた日付を全部保存」と送ってください。',
  ].join('\n');
}

function labelForMetric(metricKey) {
  const found = METRIC_DEFS.find((m) => m.key === metricKey);
  return found ? found.label : metricKey;
}

function buildMetricReply(metricKey, date, metricData) {
  const label = labelForMetric(metricKey);
  if (!metricData || !metricData.value) {
    return `${label} は ${date} の値がまだ安定して読めていません。別の日付を見るなら日付をそのまま送ってください。`;
  }
  return `${label} は ${date} で ${metricData.value}${metricData.flag ? `（${metricData.flag}）` : ''} と読めています。`;
}

function summarizeTrendForMetric(metricKey, metricsByDate, panelDates) {
  const label = labelForMetric(metricKey);
  const points = [];
  for (const date of panelDates) {
    const item = metricsByDate[date] && metricsByDate[date][metricKey];
    if (item && item.value != null) points.push({ date, value: item.value, flag: item.flag || null });
  }
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  const first = points[0];
  return `・${label}: ${first.date} は ${first.value}${first.flag ? `(${first.flag})` : ''}、${latest.date} は ${latest.value}${latest.flag ? `(${latest.flag})` : ''}`;
}

function buildTrendSummary(labState) {
  const panelDates = labState.panelDates || [];
  const metricsByDate = labState.metricsByDate || {};
  if (!panelDates.length) {
    return 'まだ推移をまとめるだけの検査日が取れていません。';
  }

  const lines = [];
  for (const key of ['tg', 'hba1c', 'ldl', 'hdl', 'ast', 'alt', 'ggt']) {
    const line = summarizeTrendForMetric(key, metricsByDate, panelDates);
    if (line) lines.push(line);
  }

  if (!lines.length) {
    return '日付は読み取れていますが、推移として安定して見える値はまだ少ないです。気になる項目を一つずつ聞いてもらえれば優先して見ます。';
  }

  return ['今までの傾向をざっくり整理します。', ...lines].join('\n');
}

function parseLabImageAnalysis(payload) {
  const combinedText = combinePayloadTexts(payload);
  const dateInfo = extractPanelDates(combinedText);
  const panelDates = dateInfo.panelDates.length ? dateInfo.panelDates : dateInfo.labeledExamDates;
  const selectedDate = payload && payload.selectedDate ? payload.selectedDate : pickDefaultDate(panelDates);
  const metricsByDate = buildMetricsByDate(combinedText, panelDates || []);

  return {
    issuedDate: dateInfo.issuedDate || null,
    panelDates: panelDates || [],
    selectedDate: selectedDate || null,
    metrics: selectedDate ? (metricsByDate[selectedDate] || {}) : (metricsByDate.single || {}),
    metricsByDate,
    rawText: combinedText,
  };
}

function makeLabSessionState(analysis) {
  return {
    kind: 'lab_panel',
    issuedDate: analysis.issuedDate || null,
    panelDates: analysis.panelDates || [],
    selectedDate: analysis.selectedDate || null,
    metricsByDate: analysis.metricsByDate || {},
    metricsBySelectedDate: analysis.metrics || {},
    rawText: analysis.rawText || '',
    updatedAt: new Date().toISOString(),
  };
}

function hasEnoughMetrics(metrics) {
  return Object.keys(metrics || {}).length >= 2;
}

function handleLabFollowup(inputText, labState) {
  const text = String(inputText || '');
  if (!labState) return null;

  const askedDate = extractDateSelection(text, labState.panelDates);
  const selectedDate = askedDate || labState.selectedDate || pickDefaultDate(labState.panelDates);
  const metricKey = detectFollowupMetric(text);

  if (/傾向|推移|分析|今まで/.test(text)) {
    return { reply: buildTrendSummary(labState), selectedDate };
  }

  if (askedDate && !metricKey) {
    return {
      reply: `${askedDate} を優先して見ます。このまま「TGは？」「HbA1cは？」のように聞いて大丈夫です。`,
      selectedDate: askedDate,
    };
  }

  if (/全部保存|全て保存|読み取れた日付を全部保存/.test(text)) {
    const saveable = (labState.panelDates || []).filter((d) => hasEnoughMetrics(labState.metricsByDate && labState.metricsByDate[d]));
    if (saveable.length) {
      return {
        reply: `読み取れた日付のうち、主要項目が見えている ${saveable.length} 日分を整理しました。今までの傾向も見られます。`,
        selectedDate: selectedDate || pickDefaultDate(saveable),
        savedDates: saveable,
      };
    }
    return {
      reply: '読み取れた日付はありますが、数値の並びがまだ弱いです。気になる日付を送るか、「今までの傾向は？」と聞いてもらえれば整理を続けます。',
      selectedDate,
    };
  }

  if (metricKey) {
    const dateMetrics = (labState.metricsByDate && labState.metricsByDate[selectedDate]) || {};
    const metricData = dateMetrics[metricKey] || null;
    return {
      reply: buildMetricReply(metricKey, selectedDate, metricData),
      selectedDate,
      metricKey,
      metricData,
    };
  }

  return null;
}

module.exports = {
  METRIC_DEFS,
  parseLabImageAnalysis,
  makeLabSessionState,
  handleLabFollowup,
  extractPanelDates,
  extractDateSelection,
  detectFollowupMetric,
  buildDateListReply,
  buildTrendSummary,
};
