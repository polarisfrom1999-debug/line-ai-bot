'use strict';

/**
 * services/lab_image_analysis_service.js
 *
 * Phase 6: lab reading rebuilt around panel dates + metric rows.
 *
 * 目的:
 * - 血液検査画像から「帳票日」と「検査列日付」を分けて扱う
 * - 複数日付の列構造を優先して読む
 * - TG / HbA1c / LDL / HDL / AST / ALT / γ-GTP の値セルを日付別に拾う
 * - follow-up で「TGは？」「HbA1cは？」に日付優先で答えやすくする
 *
 * 注意:
 * - 既存 Gemini / OCR / 画像解析の返り text を受け取って使えるよう、
 *   生テキスト中心の再抽出ロジックで構成している
 * - 外部API呼び出しはここに入れず、あくまで正規化と抽出に寄せている
 */

const IMPORTANT_METRICS = [
  { key: 'tg', aliases: ['TG', '中性脂肪', 'トリグリセリド'] },
  { key: 'hba1c', aliases: ['HbA1c', 'HBA1C', 'HbA1c(NGSP)', 'HbA1c（NGSP）'] },
  { key: 'ldl', aliases: ['LDL', 'LDLコレステロール', 'LDL-コレステロール', 'LDL(コレステロール)'] },
  { key: 'hdl', aliases: ['HDL', 'HDLコレステロール', 'HDL-コレステロール', 'HDL(コレステロール)'] },
  { key: 'ast', aliases: ['AST', 'GOT', 'GOT(AST)'] },
  { key: 'alt', aliases: ['ALT', 'GPT', 'GPT(ALT)'] },
  { key: 'ggt', aliases: ['γ-GTP', 'γGTP', 'GGT', 'γｰGTP'] },
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
};

function compactText(input) {
  return String(input || '')
    .replace(/\r/g, '\n')
    .replace(/[\u3000\t]+/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

function normalizeDateToken(token) {
  if (!token) return null;
  const raw = String(token).trim();

  let m = raw.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;

  m = raw.match(/^(\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) {
    const yy = Number(m[1]);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${yyyy}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  m = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;

  return null;
}

function findAllDateTokens(text) {
  const source = compactText(text);
  if (!source) return [];

  const regex = /(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{2}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日)/g;
  const found = new Set();
  let match;
  while ((match = regex.exec(source))) {
    const normalized = normalizeDateToken(match[1]);
    if (normalized) found.add(normalized);
  }
  return Array.from(found);
}

function parseReportIssuedDate(text) {
  const source = compactText(text);
  const patterns = [
    /印刷日[:：]?\s*(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})/i,
    /作成日[:：]?\s*(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})/i,
    /報告日[:：]?\s*(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return normalizeDateToken(match[1]);
  }
  return null;
}

function looksLikePanelDateLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  const count = findAllDateTokens(trimmed).length;
  if (count >= 2) return true;
  if (/基準値/.test(trimmed) && count >= 1) return true;
  return false;
}

function extractPanelDates(text) {
  const source = compactText(text);
  const issuedDate = parseReportIssuedDate(source);
  const lines = source.split('\n').map((s) => s.trim()).filter(Boolean);

  let panelDateCandidates = [];
  for (const line of lines) {
    if (!looksLikePanelDateLine(line)) continue;
    panelDateCandidates.push(...findAllDateTokens(line));
  }

  if (!panelDateCandidates.length) {
    panelDateCandidates = findAllDateTokens(source);
  }

  const seen = new Set();
  const filtered = [];
  for (const d of panelDateCandidates) {
    if (!d || seen.has(d)) continue;
    if (issuedDate && d === issuedDate) continue;
    seen.add(d);
    filtered.push(d);
  }

  filtered.sort();
  return {
    issuedDate,
    panelDates: filtered,
  };
}

function buildMetricPattern(metricDef) {
  const aliases = metricDef.aliases
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  return new RegExp(`(?:^|\\s)(${aliases.join('|')})(?:\\s|$)`, 'i');
}

function tokenizeNumbers(line) {
  const out = [];
  const regex = /(-?\d+(?:\.\d+)?)(?:\s*([HL]))?/g;
  let m;
  while ((m = regex.exec(line))) {
    out.push({ value: m[1], flag: m[2] || null, index: m.index });
  }
  return out;
}

function removeReferenceRangeNoise(line) {
  return String(line || '')
    .replace(/\b\d+(?:\.\d+)?\s*[~〜-]\s*\d+(?:\.\d+)?\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*to\s*\d+(?:\.\d+)?\b/gi, ' ')
    .replace(/\b(?:mg\/dL|g\/dL|U\/L|%|mEq\/L|x10|IU\/L|pg\/mL|ng\/dL)\b/gi, ' ');
}

function findMetricLine(text, metricDef) {
  const pattern = buildMetricPattern(metricDef);
  const lines = compactText(text).split('\n');
  for (const line of lines) {
    if (pattern.test(line)) return line;
  }
  return null;
}

function extractMetricFromLineByDate(line, panelDates, targetDate) {
  if (!line) return null;
  const cleaned = removeReferenceRangeNoise(line);
  const numbers = tokenizeNumbers(cleaned);
  if (!numbers.length) return null;

  // 単日表なら最初の結果値を返す
  if (!panelDates || panelDates.length <= 1) {
    return { value: numbers[0].value, flag: numbers[0].flag || null };
  }

  const idx = Math.max(0, panelDates.indexOf(targetDate));
  if (idx < numbers.length) {
    return { value: numbers[idx].value, flag: numbers[idx].flag || null };
  }

  // 最後に使える値を fallback
  const fallback = numbers[numbers.length - 1];
  return { value: fallback.value, flag: fallback.flag || null };
}

function extractImportantMetricsByDate(text, panelDates, targetDate) {
  const result = {};
  for (const metric of IMPORTANT_METRICS) {
    const line = findMetricLine(text, metric);
    const value = extractMetricFromLineByDate(line, panelDates, targetDate);
    if (value && value.value != null) {
      result[metric.key] = {
        metricKey: metric.key,
        value: String(value.value),
        flag: value.flag || null,
        sourceLine: line,
      };
    }
  }
  return result;
}

function pickDefaultDate(panelDates) {
  if (!Array.isArray(panelDates) || !panelDates.length) return null;
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
    return '血液検査画像は受け取りましたが、日付列の読み取りがまだ安定していません。もう少しはっきり写る画像があると助かります。';
  }
  const bullets = panelDates.map((d) => `・${d}`).join('\n');
  return [
    '複数の日付を読み取りました。',
    bullets,
    '1日分を確認するなら日付をそのまま送ってください。',
    '全部まとめて保存するなら「読み取れた日付を全部保存」と送ってください。',
  ].join('\n');
}

function buildMetricReply(metricKey, date, metricData) {
  const labels = {
    tg: 'TG（中性脂肪）',
    hba1c: 'HbA1c',
    ldl: 'LDL',
    hdl: 'HDL',
    ast: 'AST',
    alt: 'ALT',
    ggt: 'γ-GTP',
  };
  const label = labels[metricKey] || metricKey;
  if (!metricData || !metricData.value) {
    return `${label} は ${date} の値がまだ安定して読めていません。別の日付を見るなら日付をそのまま送ってください。`;
  }
  return `${label} は ${date} で ${metricData.value}${metricData.flag ? `（${metricData.flag}）` : ''} と読めています。`;
}

function parseLabImageAnalysis(payload) {
  const rawText = compactText(
    payload && (payload.priorityRawText || payload.matrixRawText || payload.rawText || payload.text || '')
  );
  const dateInfo = extractPanelDates(rawText);
  const selectedDate = payload && payload.selectedDate ? payload.selectedDate : pickDefaultDate(dateInfo.panelDates);
  const metrics = extractImportantMetricsByDate(rawText, dateInfo.panelDates, selectedDate);

  return {
    issuedDate: dateInfo.issuedDate || null,
    panelDates: dateInfo.panelDates,
    selectedDate,
    metrics,
    rawText,
  };
}

function makeLabSessionState(analysis) {
  return {
    kind: 'lab_panel',
    issuedDate: analysis.issuedDate || null,
    panelDates: analysis.panelDates || [],
    selectedDate: analysis.selectedDate || null,
    metricsBySelectedDate: analysis.metrics || {},
    rawText: analysis.rawText || '',
    updatedAt: new Date().toISOString(),
  };
}

function handleLabFollowup(inputText, labState) {
  const text = String(inputText || '');
  if (!labState) return null;

  const askedDate = extractDateSelection(text, labState.panelDates);
  const selectedDate = askedDate || labState.selectedDate || pickDefaultDate(labState.panelDates);
  const metricKey = detectFollowupMetric(text);

  if (askedDate && !metricKey) {
    return {
      reply: `${askedDate} を優先して見ます。このまま「TGは？」「HbA1cは？」のように聞いても大丈夫です。`,
      selectedDate: askedDate,
    };
  }

  if (metricKey) {
    const metrics = extractImportantMetricsByDate(labState.rawText, labState.panelDates, selectedDate);
    const metricData = metrics[metricKey] || null;
    return {
      reply: buildMetricReply(metricKey, selectedDate, metricData),
      selectedDate,
      metricKey,
      metricData,
    };
  }

  if (/全部保存|全て保存|読み取れた日付を全部保存/.test(text)) {
    return {
      reply: '読み取れた日付はありましたが、数値の保存はまだ安定していません。今回の画像を優先して確認は続けられます。',
      selectedDate,
    };
  }

  return null;
}

module.exports = {
  IMPORTANT_METRICS,
  parseLabImageAnalysis,
  makeLabSessionState,
  handleLabFollowup,
  extractPanelDates,
  extractImportantMetricsByDate,
  extractDateSelection,
  detectFollowupMetric,
  buildDateListReply,
};
