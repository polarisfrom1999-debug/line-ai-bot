'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');

const LAB_DOCUMENT_HINTS = [
  '検査結果', '検査結果リスト', '血液検査', '基準値', '検査項目', '総コレステロール', '中性脂肪', 'TG', 'HbA1c', 'LDL', 'HDL', 'AST', 'ALT'
];

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
  'LDH',
  'BUN',
  'CRE'
];

const TARGET_ALIASES = {
  '中性脂肪': ['中性脂肪', 'TG', 'トリグリセリド', 'TG(中性脂肪)'],
  'HbA1c': ['HbA1c', 'HbA1c(NGSP)', 'HBA1C', 'HB1AC'],
  'LDL': ['LDL', 'LDLコレステロール', 'LDL-CHO', 'LDL(IFCC)'],
  'HDL': ['HDL', 'HDLコレステロール', 'HDL-CHO', 'HDL(HDL-コレステロール)'],
  'AST': ['AST', 'GOT', 'AST(GOT)'],
  'ALT': ['ALT', 'GPT', 'ALT(GPT)'],
  'γ-GTP': ['γ-GTP', 'γGTP', 'GTP', 'GGT'],
  'クレアチニン': ['クレアチニン', 'CRE'],
  '尿素窒素': ['尿素窒素', 'BUN'],
  'eGFR': ['eGFR'],
  '尿酸': ['尿酸', 'UA'],
  '空腹時血糖': ['空腹時血糖', '血糖'],
  '血糖': ['血糖'],
  'ALP': ['ALP'],
  'LDH': ['LDH']
};

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
    .replace(/ＬＤＨ/gi, 'LDH')
    .replace(/ＢＵＮ/gi, 'BUN')
    .replace(/ＣＲＥ/gi, 'CRE')
    .replace(/ＥＧＦＲ/gi, 'eGFR')
    .replace(/\s+/g, ' ')
    .trim();

  if (!safe) return '';
  const upper = safe.toUpperCase();
  if (/^TG$/i.test(safe)) return '中性脂肪';
  if (upper.includes('中性脂肪') || upper.includes('TRIG')) return '中性脂肪';
  if (upper.includes('HBA1C')) return 'HbA1c';
  if (upper.includes('LDL')) return 'LDL';
  if (upper.includes('HDL')) return 'HDL';
  if (upper.includes('AST') || upper.includes('GOT')) return 'AST';
  if (upper.includes('ALT') || upper.includes('GPT')) return 'ALT';
  if (upper.includes('GTP') || upper.includes('GGT')) return 'γ-GTP';
  if (upper.includes('LDH')) return 'LDH';
  if (upper.includes('ALP')) return 'ALP';
  if (upper.includes('EGFR')) return 'eGFR';
  if (upper.includes('CRE') || safe.includes('クレアチニン')) return 'クレアチニン';
  if (upper.includes('BUN') || safe.includes('尿素窒素')) return '尿素窒素';
  if (safe.includes('尿酸') || upper === 'UA') return '尿酸';
  if (safe.includes('空腹時血糖')) return '空腹時血糖';
  if (safe.includes('血糖')) return '血糖';
  return safe;
}

function normalizeValue(value) {
  return normalizeText(value).replace(/[^\d.\-]/g, '');
}

function normalizeUnit(unit) {
  return normalizeText(unit)
    .replace(/ｍｇ\/ｄＬ/gi, 'mg/dL')
    .replace(/％/g, '%')
    .replace(/μ/g, 'u')
    .replace(/IU\/ℓ/gi, 'IU/L')
    .replace(/U\/ℓ/gi, 'U/L');
}

function normalizeFlag(flag) {
  const safe = normalizeText(flag).toUpperCase();
  return safe === 'H' || safe === 'L' ? safe : '';
}

function normalizeDateToken(token) {
  const safe = normalizeText(token).replace(/日/g, '');
  const match = safe.match(/(20\d{2}|\d{2})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})/);
  if (!match) return '';
  let year = Number(match[1]);
  if (year < 100) year += 2000;
  const month = String(Number(match[2])).padStart(2, '0');
  const day = String(Number(match[3])).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function extractDateCandidates(rawText = '') {
  const safe = sanitizeGeminiText(rawText);
  if (!safe) return [];

  const seen = new Set();
  const dates = [];
  const regex = /(20\d{2}|\d{2})[\/\-.年]\s*\d{1,2}[\/\-.月]\s*\d{1,2}(?:日)?/g;
  for (const match of safe.matchAll(regex)) {
    const normalized = normalizeDateToken(match[0]);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    dates.push(normalized);
  }
  return dates;
}

function looksLikeLabDocumentText(rawText = '') {
  const safe = sanitizeGeminiText(rawText);
  if (!safe) return false;
  return LAB_DOCUMENT_HINTS.some((hint) => safe.includes(hint));
}

function uniqueHistory(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      date: normalizeText(row?.date || ''),
      value: normalizeValue(row?.value || ''),
      unit: normalizeUnit(row?.unit || ''),
      flag: normalizeFlag(row?.flag || '')
    }))
    .filter((row) => row.date && row.value)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .filter((row) => {
      const key = `${row.date}:${row.value}:${row.unit}:${row.flag}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  const merged = new Map();

  for (const item of items) {
    const itemName = normalizeItemName(item?.itemName || item?.name || '');
    if (!itemName) continue;
    const value = normalizeValue(item?.value || item?.currentValue || '');
    const unit = normalizeUnit(item?.unit || item?.currentUnit || '');
    const flag = normalizeFlag(item?.flag || item?.currentFlag || '');
    const history = uniqueHistory(item?.history || []);

    if (!value && !history.length) continue;

    const existing = merged.get(itemName) || { itemName, value: '', unit: '', flag: '', history: [] };
    merged.set(itemName, {
      itemName,
      value: existing.value || value,
      unit: existing.unit || unit,
      flag: existing.flag || flag,
      history: uniqueHistory([...(existing.history || []), ...history])
    });
  }

  return [...merged.values()];
}

function inferIsLabImage(items, examDate, rawText = '', dateCandidates = []) {
  return Boolean(
    (Array.isArray(items) && items.length) ||
    normalizeText(examDate) ||
    (Array.isArray(dateCandidates) && dateCandidates.length) ||
    looksLikeLabDocumentText(rawText)
  );
}

function extractUnitFromLine(line) {
  const unitMatch = normalizeText(line).match(/(mg\/dL|IU\/L|U\/L|ng\/dL|pg\/mL|%|g\/dL|x10|万\/uL|\/uL|mEq\/L)/i);
  return normalizeUnit(unitMatch?.[1] || '');
}

function lineIncludesAlias(line, canonicalName) {
  const upperLine = normalizeText(line).toUpperCase();
  const aliases = TARGET_ALIASES[canonicalName] || [canonicalName];
  return aliases.some((alias) => upperLine.includes(String(alias).toUpperCase()));
}

function extractNumericTokens(line) {
  const values = [];
  for (const match of normalizeText(line).matchAll(/([HL])?\s*([0-9]+(?:\.[0-9]+)?)/g)) {
    values.push({
      flag: normalizeFlag(match[1] || ''),
      value: normalizeValue(match[2] || '')
    });
  }
  return values.filter((row) => row.value);
}

function buildItemFromLine(line, canonicalName, dateCandidates = []) {
  if (!lineIncludesAlias(line, canonicalName)) return null;

  const tokens = extractNumericTokens(line);
  if (!tokens.length) return null;

  const unit = extractUnitFromLine(line);
  if (dateCandidates.length >= 2 && tokens.length >= 2) {
    const usableCount = Math.min(dateCandidates.length, tokens.length);
    const pickedDates = dateCandidates.slice(-usableCount);
    const pickedTokens = tokens.slice(-usableCount);
    const history = uniqueHistory(pickedTokens.map((token, index) => ({
      date: pickedDates[index],
      value: token.value,
      unit,
      flag: token.flag
    })));
    const latest = history[history.length - 1] || null;
    if (latest) {
      return {
        itemName: canonicalName,
        value: latest.value,
        unit: latest.unit || unit,
        flag: latest.flag || '',
        history
      };
    }
  }

  const latest = tokens[tokens.length - 1];
  return {
    itemName: canonicalName,
    value: latest.value,
    unit,
    flag: latest.flag,
    history: []
  };
}

function tryHeuristicExtract(rawText) {
  const safe = sanitizeGeminiText(rawText);
  const dateCandidates = extractDateCandidates(safe);
  if (!safe) {
    return { examDate: '', dateCandidates, items: [] };
  }

  const lines = safe.split(/\n+/).map((line) => normalizeText(line)).filter(Boolean);
  const items = [];
  const seen = new Set();

  for (const target of TARGET_ITEMS) {
    const canonical = normalizeItemName(target);
    if (!canonical || seen.has(canonical)) continue;

    for (const line of lines) {
      const built = buildItemFromLine(line, canonical, dateCandidates);
      if (!built) continue;
      items.push(built);
      seen.add(canonical);
      break;
    }
  }

  return {
    examDate: dateCandidates.slice(-1)[0] || '',
    dateCandidates,
    items: normalizeItems(items)
  };
}

function mergeNormalizedItems(primaryItems, extraItems) {
  return normalizeItems([...(Array.isArray(primaryItems) ? primaryItems : []), ...(Array.isArray(extraItems) ? extraItems : [])]);
}

function extractTargetItemFromRawText(rawText, targetName, preferredDate = 'latest', explicitDateCandidates = []) {
  const canonical = normalizeItemName(targetName);
  const safe = sanitizeGeminiText(rawText);
  if (!safe || !canonical) return null;

  const dateCandidates = Array.isArray(explicitDateCandidates) && explicitDateCandidates.length
    ? explicitDateCandidates
    : extractDateCandidates(safe);

  const lines = safe.split(/\n+/).map((line) => normalizeText(line)).filter(Boolean);
  for (const line of lines) {
    const item = buildItemFromLine(line, canonical, dateCandidates);
    if (!item) continue;

    if (preferredDate && preferredDate !== 'latest') {
      const row = (item.history || []).find((historyRow) => historyRow.date === preferredDate);
      if (row) {
        return {
          itemName: canonical,
          value: row.value,
          unit: row.unit || item.unit,
          flag: row.flag || ''
        };
      }
    }

    if ((item.history || []).length) {
      const row = item.history[item.history.length - 1];
      return {
        itemName: canonical,
        value: row.value,
        unit: row.unit || item.unit,
        flag: row.flag || ''
      };
    }

    return item;
  }

  return null;
}

function getItemValueByDate(items, targetName, preferredDate = 'latest') {
  const canonical = normalizeItemName(targetName);
  const list = normalizeItems(items);
  const item = list.find((entry) => normalizeItemName(entry.itemName) === canonical);
  if (!item) return null;

  if (preferredDate && preferredDate !== 'latest') {
    const row = (item.history || []).find((historyRow) => historyRow.date === preferredDate);
    if (row) {
      return {
        itemName: item.itemName,
        value: row.value,
        unit: row.unit || item.unit,
        flag: row.flag || ''
      };
    }
  }

  if ((item.history || []).length) {
    const row = item.history[item.history.length - 1];
    return {
      itemName: item.itemName,
      value: row.value,
      unit: row.unit || item.unit,
      flag: row.flag || ''
    };
  }

  if (item.value) {
    return {
      itemName: item.itemName,
      value: item.value,
      unit: item.unit,
      flag: item.flag || ''
    };
  }

  return null;
}

function buildPanelsFromLabAnalysis(lab, requestedDates = []) {
  const items = normalizeItems(lab?.items || []);
  const dateCandidates = Array.isArray(requestedDates) && requestedDates.length
    ? requestedDates
    : Array.isArray(lab?.dateCandidates) && lab.dateCandidates.length
      ? lab.dateCandidates
      : normalizeText(lab?.examDate || '')
        ? [normalizeText(lab.examDate)]
        : [];

  const panels = [];
  for (const date of dateCandidates) {
    const panelItems = [];
    for (const item of items) {
      const historyRow = (item.history || []).find((row) => row.date === date);
      if (historyRow) {
        panelItems.push({
          itemName: item.itemName,
          value: historyRow.value,
          unit: historyRow.unit || item.unit,
          flag: historyRow.flag || '',
          history: []
        });
        continue;
      }
      if (normalizeText(lab?.examDate || '') === date && item.value) {
        panelItems.push({
          itemName: item.itemName,
          value: item.value,
          unit: item.unit,
          flag: item.flag || '',
          history: []
        });
      }
    }

    if (panelItems.length) {
      panels.push({
        examDate: date,
        source: normalizeText(lab?.source || 'image'),
        items: panelItems
      });
    }
  }

  return panels;
}

async function analyzePriorityLabImage(imagePayload) {
  const prompt = [
    'この画像が血液検査結果であれば、検査表の主要項目だけをJSONで返してください。',
    '特に TG(中性脂肪), HbA1c, LDL, HDL, AST, ALT, γ-GTP を優先してください。',
    '複数の日付列が見える場合は dateCandidates に列見出しの日付を左から右へ並べてください。',
    '基準値ではなく、今回の結果値だけを items.value に入れてください。',
    'JSONのみを返してください。',
    '{',
    '  "examDate": "YYYY-MM-DD または 空文字",',
    '  "dateCandidates": ["YYYY-MM-DD"],',
    '  "items": [',
    '    { "itemName": "中性脂肪", "value": "91", "unit": "mg/dL", "flag": "" }',
    '  ]',
    '}'
  ].join('\n');

  const result = await geminiImageAnalysisService.analyzeImage({ imagePayload, prompt });
  if (!result.ok) {
    return { examDate: '', dateCandidates: [], items: [], rawText: '' };
  }

  const parsed = extractJsonObject(result.text);
  const items = normalizeItems(parsed?.items || []);
  const dateCandidates = [...new Set([
    ...(Array.isArray(parsed?.dateCandidates) ? parsed.dateCandidates.map(normalizeDateToken) : []),
    ...extractDateCandidates(result.text)
  ].filter(Boolean))];

  return {
    examDate: normalizeText(parsed?.examDate || dateCandidates.slice(-1)[0] || ''),
    dateCandidates,
    items,
    rawText: sanitizeGeminiText(result.text)
  };
}

async function analyzeLabImage(imagePayload) {
  const prompt = [
    'この画像が血液検査結果なら、表を読んでJSONで返してください。',
    '最初に複数の日付列が見えるかを確認し、dateCandidates に左から右の順で YYYY-MM-DD にして入れてください。',
    '各項目では最新列の value を返し、過去列が見える場合は history に date/value を入れてください。',
    '項目は LDL, HDL, TG(中性脂肪), HbA1c, AST, ALT, γ-GTP を優先しつつ、見えた主要項目を入れてください。',
    'JSONのみを返してください。',
    '{',
    '  "isLabImage": true,',
    '  "examDate": "最新の日付を YYYY-MM-DD または 空文字",',
    '  "dateCandidates": ["YYYY-MM-DD"],',
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
    '  "documentType": "blood_test | unknown",',
    '  "confidence": 0.0',
    '}'
  ].join('\n');

  const result = await geminiImageAnalysisService.analyzeImage({ imagePayload, prompt });

  if (!result.ok) {
    return {
      source: 'image',
      isLabImage: false,
      examDate: '',
      dateCandidates: [],
      items: [],
      confidence: 0
    };
  }

  const priority = await analyzePriorityLabImage(imagePayload);
  const heuristic = tryHeuristicExtract(result.text);
  const parsed = extractJsonObject(result.text);

  const parsedItems = normalizeItems(parsed?.items || []);
  const mergedItems = mergeNormalizedItems(parsedItems, mergeNormalizedItems(priority.items, heuristic.items));
  const dateCandidates = [...new Set([
    ...(Array.isArray(parsed?.dateCandidates) ? parsed.dateCandidates.map(normalizeDateToken) : []),
    ...(priority.dateCandidates || []),
    ...(heuristic.dateCandidates || []),
    ...extractDateCandidates(result.text)
  ].filter(Boolean))];

  return {
    source: 'image',
    isLabImage: Boolean(parsed?.isLabImage || inferIsLabImage(mergedItems, parsed?.examDate || priority.examDate || heuristic.examDate, result.text, dateCandidates)),
    examDate: normalizeText(parsed?.examDate || priority.examDate || heuristic.examDate || dateCandidates.slice(-1)[0] || ''),
    dateCandidates,
    items: mergedItems,
    confidence: Number(parsed?.confidence || (mergedItems.length ? 0.72 : dateCandidates.length ? 0.63 : 0)),
    rawText: sanitizeGeminiText(result.text),
    priorityRawText: priority.rawText || '',
    labLike: looksLikeLabDocumentText(result.text) || String(parsed?.documentType || '').toLowerCase() === 'blood_test'
  };
}

module.exports = {
  analyzeLabImage,
  buildPanelsFromLabAnalysis,
  extractDateCandidates,
  extractTargetItemFromRawText,
  getItemValueByDate
};
