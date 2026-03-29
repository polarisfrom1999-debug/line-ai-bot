'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');

const TARGET_ITEMS = [
  'LDL',
  'HDL',
  'non-HDLコレステロール',
  '中性脂肪',
  'TG',
  'HbA1c',
  'AST',
  'ALT',
  'γ-GTP',
  'γGTP',
  'ALP',
  '尿酸',
  '血糖',
  '空腹時血糖',
  'クレアチニン',
  'eGFR',
  '尿素窒素',
  'LDH',
  '総コレステロール',
  '赤血球',
  '白血球',
  'ヘモグロビン'
];

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizeGeminiText(text) {
  return normalizeText(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '');
}

function extractJsonObject(text) {
  const safe = sanitizeGeminiText(text);
  const start = safe.indexOf('{');
  const end = safe.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(safe.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function normalizeItemName(name) {
  const safe = normalizeText(name)
    .replace(/ＬＤＬ/gi, 'LDL')
    .replace(/ＨＤＬ/gi, 'HDL')
    .replace(/ＴＧ/gi, 'TG')
    .replace(/ｎｏｎ-ＨＤＬ/gi, 'non-HDL')
    .replace(/ＨｂＡ１ｃ/gi, 'HbA1c')
    .replace(/hb1ac/gi, 'HbA1c')
    .replace(/ＡＳＴ/gi, 'AST')
    .replace(/ＡＬＴ/gi, 'ALT')
    .replace(/γＧＴＰ/gi, 'γ-GTP')
    .replace(/γGTP/gi, 'γ-GTP')
    .replace(/ＧＧＴ/gi, 'γ-GTP')
    .replace(/GOT/gi, 'AST')
    .replace(/GPT/gi, 'ALT')
    .replace(/クレアチニン\s*\(.*?\)/gi, 'クレアチニン')
    .replace(/総コレステロール/gi, '総コレステロール')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^TG$/i.test(safe)) return '中性脂肪';
  if (/^空腹時血糖$/i.test(safe)) return '空腹時血糖';
  if (/^血糖$/i.test(safe)) return '血糖';
  if (/^NON-HDL/i.test(safe)) return 'non-HDLコレステロール';
  return safe;
}

function normalizeValue(value) {
  return normalizeText(value).replace(/[^\d.\-]/g, '');
}

function normalizeUnit(unit) {
  return normalizeText(unit)
    .replace(/ｍｇ\/ｄＬ/gi, 'mg/dL')
    .replace(/μ/g, 'u')
    .replace(/％/g, '%');
}

function normalizeFlag(flag) {
  const safe = normalizeText(flag).toUpperCase();
  if (safe === 'H' || safe === 'L') return safe;
  return '';
}

function looksLikeTargetItem(name) {
  const safe = normalizeItemName(name);
  return TARGET_ITEMS.some((item) => safe.toUpperCase() === normalizeItemName(item).toUpperCase());
}

function normalizeHistoryRows(rows, fallbackUnit = '') {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      date: normalizeText(row?.date || ''),
      value: normalizeValue(row?.value || ''),
      unit: normalizeUnit(row?.unit || fallbackUnit),
      flag: normalizeFlag(row?.flag || '')
    }))
    .filter((row) => row.date && row.value);
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];

  const normalized = [];
  const seen = new Set();

  for (const item of items) {
    const itemName = normalizeItemName(item?.itemName || item?.name || '');
    const value = normalizeValue(item?.value || item?.currentValue || '');
    const unit = normalizeUnit(item?.unit || item?.currentUnit || '');
    const flag = normalizeFlag(item?.flag || item?.currentFlag || '');

    if (!itemName) continue;
    if (!looksLikeTargetItem(itemName)) continue;

    const history = normalizeHistoryRows(item?.history, unit);
    if (!value && !history.length) continue;

    const key = `${itemName}:${value}:${unit}:${flag}`;
    if (seen.has(key) && !history.length) continue;
    seen.add(key);

    normalized.push({
      itemName,
      value,
      unit,
      flag,
      history
    });
  }

  return normalized;
}

function inferIsLabImage(items, examDate, rawText = '') {
  return Boolean(
    (Array.isArray(items) && items.length) ||
    normalizeText(examDate) ||
    /検査結果|血液検査|コレステロール|HbA1c|LDL|HDL/.test(rawText)
  );
}

function sortHistoryRows(rows) {
  return [...rows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

function uniqueHistory(rows) {
  const seen = new Set();
  return sortHistoryRows(rows).filter((row) => {
    const key = `${row.date}:${row.value}:${row.unit || ''}:${row.flag || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildPanelsFromItems(examDate, items) {
  const byDate = new Map();

  function pushRow(date, itemName, value, unit, flag) {
    const safeDate = normalizeText(date);
    const safeValue = normalizeValue(value);
    if (!safeDate || !safeValue) return;

    const key = safeDate;
    const bucket = byDate.get(key) || { examDate: safeDate, source: 'image', items: [] };
    bucket.items.push({
      itemName: normalizeItemName(itemName),
      value: safeValue,
      unit: normalizeUnit(unit),
      flag: normalizeFlag(flag),
      history: []
    });
    byDate.set(key, bucket);
  }

  for (const item of Array.isArray(items) ? items : []) {
    if (examDate && item?.value) pushRow(examDate, item.itemName, item.value, item.unit, item.flag);
    for (const row of item?.history || []) {
      pushRow(row.date, item.itemName, row.value, row.unit || item.unit, row.flag || '');
    }
  }

  return [...byDate.values()]
    .map((panel) => ({
      ...panel,
      items: panel.items.filter((entry, index, arr) => arr.findIndex((x) => `${x.itemName}:${x.value}:${x.unit}:${x.flag}` === `${entry.itemName}:${entry.value}:${entry.unit}:${entry.flag}`) === index)
    }))
    .sort((a, b) => String(a.examDate || '').localeCompare(String(b.examDate || '')));
}

function normalizeDateToken(token) {
  const safe = normalizeText(token);
  let match = safe.match(/(20\d{2})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})/);
  if (match) {
    return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  }

  match = safe.match(/(\d{2})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})/);
  if (!match) return '';

  const yy = Number(match[1]);
  const year = yy >= 80 ? 1900 + yy : 2000 + yy;
  return `${year}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}

function tryHeuristicExtract(rawText) {
  const safe = sanitizeGeminiText(rawText);
  if (!safe) {
    return {
      examDate: '',
      items: []
    };
  }

  const dateMatches = [...safe.matchAll(/20\d{2}[\/\-.年]\s*\d{1,2}[\/\-.月]\s*\d{1,2}/g)]
    .map((m) => normalizeDateToken(m[0]))
    .filter(Boolean);

  const items = [];
  const seen = new Set();

  for (const target of TARGET_ITEMS) {
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lineRegex = new RegExp(`${escaped}[^\n]{0,120}`, 'ig');
    const lineMatch = safe.match(lineRegex) || [];

    for (const rawLine of lineMatch) {
      const valueMatches = [...rawLine.matchAll(/([HL])?\s*([0-9]+(?:\.[0-9]+)?)/g)];
      if (!valueMatches.length) continue;

      const itemName = normalizeItemName(target);
      const current = valueMatches[valueMatches.length - 1];
      const currentValue = normalizeValue(current[2] || '');
      const currentFlag = normalizeFlag(current[1] || '');
      const unitMatch = rawLine.match(/(mg\/dL|IU\/L|U\/L|%)/i);
      const unit = normalizeUnit(unitMatch?.[1] || '');
      const history = [];

      if (dateMatches.length >= 2 && valueMatches.length >= 2) {
        const offset = Math.max(0, dateMatches.length - valueMatches.length);
        for (let i = 0; i < Math.min(dateMatches.length, valueMatches.length); i += 1) {
          const rowDate = dateMatches[i + offset] || '';
          const valueHit = valueMatches[i];
          const rowValue = normalizeValue(valueHit?.[2] || '');
          if (!rowDate || !rowValue) continue;
          history.push({
            date: rowDate,
            value: rowValue,
            unit,
            flag: normalizeFlag(valueHit?.[1] || '')
          });
        }
      }

      const key = `${itemName}:${currentValue}:${unit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        itemName,
        value: currentValue,
        unit,
        flag: currentFlag,
        history: uniqueHistory(history)
      });
      break;
    }
  }

  return {
    examDate: dateMatches.slice(-1)[0] || '',
    items
  };
}

async function analyzeLabImage(imagePayload) {
  const prompt = [
    'この画像が血液検査結果なら、表を読んで日付と検査項目をJSONで返してください。',
    '複数の日付列がある場合は、各項目のhistoryにも過去値を入れてください。',
    '画像の中の文字を優先して正確に読んでください。',
    'JSONのみを返してください。複数日付がある場合は panels 配列にも日付ごとの items を入れてください。',
    '{',
    '  "isLabImage": true,',
    '  "examDate": "最新の日付を YYYY-MM-DD または 空文字",',
    '  "items": [',
    '    {',
    '      "itemName": "LDL",',
    '      "value": "151",',
    '      "unit": "mg/dL",',
    '      "flag": "H",',
    '      "history": [',
    '        { "date": "2024-07-01", "value": "169", "unit": "mg/dL", "flag": "H" }',
    '      ]',
    '    }',
    '  ],',
    '  "confidence": 0.0',
    '}'
  ].join('\n');

  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt
  });

  if (!result.ok) {
    return {
      source: 'image',
      isLabImage: false,
      examDate: '',
      items: [],
      confidence: 0
    };
  }

  const parsed = extractJsonObject(result.text);
  if (parsed) {
    const items = normalizeItems(parsed.items);
    const panels = Array.isArray(parsed.panels)
      ? parsed.panels
        .map((panel) => ({
          examDate: normalizeDateToken(panel?.examDate || '') || normalizeText(panel?.examDate || ''),
          source: 'image',
          items: normalizeItems(panel?.items || []).map((item) => ({
            ...item,
            history: []
          }))
        }))
        .filter((panel) => panel.examDate && panel.items.length)
      : [];

    const normalizedItems = items.map((item) => ({
      ...item,
      history: uniqueHistory(item.history || [])
    }));

    const mergedPanels = panels.length ? panels : buildPanelsFromItems(normalizeDateToken(parsed.examDate || '') || normalizeText(parsed.examDate || ''), normalizedItems);

    return {
      source: 'image',
      isLabImage: Boolean(parsed.isLabImage || inferIsLabImage(normalizedItems, parsed.examDate, result.text)),
      examDate: normalizeDateToken(parsed.examDate || '') || normalizeText(parsed.examDate || ''),
      items: normalizedItems,
      panels: mergedPanels,
      confidence: Number(parsed.confidence || 0),
      rawText: sanitizeGeminiText(result.text)
    };
  }

  const heuristic = tryHeuristicExtract(result.text);

  return {
    source: 'image',
    isLabImage: inferIsLabImage(heuristic.items, heuristic.examDate, result.text),
    examDate: heuristic.examDate,
    items: heuristic.items,
    panels: buildPanelsFromItems(heuristic.examDate, heuristic.items),
    confidence: heuristic.items.length ? 0.55 : 0,
    rawText: sanitizeGeminiText(result.text)
  };
}

module.exports = {
  analyzeLabImage
};
