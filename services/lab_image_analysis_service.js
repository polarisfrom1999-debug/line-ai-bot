'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');

const TARGET_ITEMS = [
  'LDL',
  'HDL',
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
  'LDH'
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
    .replace(/ＨｂＡ１ｃ/gi, 'HbA1c')
    .replace(/hb1ac/gi, 'HbA1c')
    .replace(/ＡＳＴ/gi, 'AST')
    .replace(/ＡＬＴ/gi, 'ALT')
    .replace(/γＧＴＰ/gi, 'γ-GTP')
    .replace(/γGTP/gi, 'γ-GTP')
    .replace(/ＧＧＴ/gi, 'γ-GTP')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^TG$/i.test(safe)) return '中性脂肪';
  if (/^空腹時血糖$/i.test(safe)) return '空腹時血糖';
  if (/^血糖$/i.test(safe)) return '血糖';
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
    /検査結果|検査結果レポート|血液検査|コレステロール|HbA1c|LDL|HDL|基準値|検査項目名称|患者番号/.test(rawText)
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

function normalizeDateToken(token) {
  const safe = normalizeText(token);
  const match = safe.match(/(20\d{2})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}

function extractDateCandidatesFromText(rawText) {
  const safe = sanitizeGeminiText(rawText);
  if (!safe) return [];

  const labeledPatterns = [
    /(?:検査日|採血日|採取日|採材日|受診日|実施日|印刷日)\s*[:：]?\s*(20\d{2}[\/\-.年]\s*\d{1,2}[\/\-.月]\s*\d{1,2})/g,
    /(?:検査日|採血日|採取日|採材日|受診日|実施日|印刷日)\s*[:：]?\s*(\d{2}[\/\-.年]\s*\d{1,2}[\/\-.月]\s*\d{1,2})/g,
  ];

  const candidates = [];
  for (const regex of labeledPatterns) {
    for (const match of safe.matchAll(regex)) {
      const token = normalizeDateToken(match[1]);
      if (token) candidates.push(token);
    }
  }

  for (const match of safe.matchAll(/20\d{2}[\/\-.年]\s*\d{1,2}[\/\-.月]\s*\d{1,2}/g)) {
    const token = normalizeDateToken(match[0]);
    if (token) candidates.push(token);
  }

  return [...new Set(candidates)].sort();
}

function mergeNormalizedItems(primaryItems, fallbackItems) {
  const map = new Map();
  for (const item of Array.isArray(primaryItems) ? primaryItems : []) {
    const normalized = {
      ...item,
      history: uniqueHistory(item.history || [])
    };
    map.set(normalizeItemName(normalized.itemName), normalized);
  }
  for (const item of Array.isArray(fallbackItems) ? fallbackItems : []) {
    const key = normalizeItemName(item.itemName);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...item,
        history: uniqueHistory(item.history || [])
      });
      continue;
    }
    map.set(key, {
      itemName: existing.itemName || item.itemName,
      value: existing.value || item.value,
      unit: existing.unit || item.unit,
      flag: existing.flag || item.flag,
      history: uniqueHistory([...(existing.history || []), ...(item.history || [])])
    });
  }
  return [...map.values()];
}

function chooseExamDate(explicitDate, heuristicDate, rawText) {
  const normalizedExplicit = normalizeDateToken(explicitDate);
  if (normalizedExplicit) return normalizedExplicit;
  const normalizedHeuristic = normalizeDateToken(heuristicDate);
  if (normalizedHeuristic) return normalizedHeuristic;
  const candidates = extractDateCandidatesFromText(rawText);
  return candidates.slice(-1)[0] || '';
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
    '検査日、採血日、受診日、印刷日のような日付が見える時は examDate に最新の対象日を入れてください。',
    '画像の中の文字を優先して正確に読んでください。',
    'JSONのみを返してください。',
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

  const heuristic = tryHeuristicExtract(result.text);
  const parsed = extractJsonObject(result.text);

  if (parsed) {
    const parsedItems = normalizeItems(parsed.items);
    const mergedItems = mergeNormalizedItems(parsedItems, heuristic.items);
    const examDate = chooseExamDate(parsed.examDate, heuristic.examDate, result.text);
    return {
      source: 'image',
      isLabImage: Boolean(parsed.isLabImage || inferIsLabImage(mergedItems, examDate, result.text)),
      examDate,
      items: mergedItems,
      confidence: Number(parsed.confidence || (mergedItems.length ? 0.6 : 0)),
      rawText: sanitizeGeminiText(result.text)
    };
  }

  const examDate = chooseExamDate('', heuristic.examDate, result.text);
  return {
    source: 'image',
    isLabImage: inferIsLabImage(heuristic.items, examDate, result.text),
    examDate,
    items: heuristic.items,
    confidence: heuristic.items.length ? 0.55 : 0,
    rawText: sanitizeGeminiText(result.text)
  };
}

module.exports = {
  analyzeLabImage
};
