'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');

const TARGET_SPECS = [
  { key: 'LDL', aliases: ['LDL', 'LDL-C', 'LDLコレステロール', 'LDL(IFCC)', 'LDL（IFCC）'] },
  { key: 'HDL', aliases: ['HDL', 'HDL-C', 'HDLコレステロール', 'HDL(HDL-コレステロール)', 'HDL（HDL-コレステロール）'] },
  { key: '中性脂肪', aliases: ['中性脂肪', 'TG', 'トリグリセリド'] },
  { key: 'HbA1c', aliases: ['HbA1c', 'HBA1C', 'Hb1Ac', 'ヘモグロビンA1c'] },
  { key: 'AST', aliases: ['AST', 'GOT'] },
  { key: 'ALT', aliases: ['ALT', 'GPT'] },
  { key: 'γ-GTP', aliases: ['γ-GTP', 'γGTP', 'GGT', 'γｰGT', 'γ-gt'] },
  { key: 'ALP', aliases: ['ALP'] },
  { key: '尿酸', aliases: ['尿酸', 'UA'] },
  { key: '血糖', aliases: ['血糖', '空腹時血糖', 'GLU'] },
  { key: 'クレアチニン', aliases: ['クレアチニン', 'CRE', 'CRE(クレアチニン)'] },
  { key: 'eGFR', aliases: ['eGFR', 'EGFR', 'eGFR（クレアチニン）', 'eGFR(クレアチニン)'] },
  { key: '尿素窒素', aliases: ['尿素窒素', 'BUN', 'BUN(尿素窒素)'] },
  { key: 'LDH', aliases: ['LDH', 'LDH(IFCC)', 'LDH（IFCC）'] },
  { key: 'CK', aliases: ['CK', 'CPK', 'CPK(CK)'] },
  { key: 'WBC', aliases: ['WBC', '白血球'] },
  { key: 'RBC', aliases: ['RBC', '赤血球'] },
  { key: 'Hgb', aliases: ['Hgb', 'Hb', '血色素量'] },
  { key: 'Hct', aliases: ['Hct', 'Ht', 'ヘマトクリット'] },
  { key: 'PLT', aliases: ['PLT', '血小板'] },
  { key: 'TSH', aliases: ['TSH'] },
  { key: 'FT4', aliases: ['FT4'] },
  { key: 'FT3', aliases: ['FT3'] }
];

function normalizeText(value) { return String(value || '').trim(); }
function sanitizeGeminiText(text) { return normalizeText(text).replace(/```json/gi, '').replace(/```/g, ''); }
function extractJsonObject(text) {
  const safe = sanitizeGeminiText(text);
  const start = safe.indexOf('{');
  const end = safe.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(safe.slice(start, end + 1)); } catch (_) { return null; }
}
function normalizeUnit(unit) {
  return normalizeText(unit)
    .replace(/ｍｇ\/ｄＬ/gi, 'mg/dL')
    .replace(/IU\/L/gi, 'IU/L')
    .replace(/％/g, '%')
    .replace(/μ/g, 'u');
}
function normalizeFlag(flag) {
  const safe = normalizeText(flag).toUpperCase();
  return safe === 'H' || safe === 'L' ? safe : '';
}
function cleanName(name) {
  return normalizeText(name)
    .replace(/[\s　]+/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/［.*?］/g, '')
    .replace(/【.*?】/g, '')
    .toUpperCase();
}
function resolveCanonicalItem(name) {
  const safe = cleanName(name);
  if (!safe) return '';
  for (const spec of TARGET_SPECS) {
    for (const alias of spec.aliases) {
      const aliasSafe = cleanName(alias);
      if (safe === aliasSafe || safe.includes(aliasSafe) || aliasSafe.includes(safe)) return spec.key;
    }
  }
  return '';
}
function normalizeDateToken(token) {
  const safe = normalizeText(token);
  const match = safe.match(/(20\d{2})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}
function extractDateCandidates(text) {
  const safe = sanitizeGeminiText(text);
  const regexes = [
    /(検査日|採血日|受診日|印刷日)\s*[:：]?\s*(20\d{2}[\/\-.年]\s*\d{1,2}[\/\-.月]\s*\d{1,2})/g,
    /(20\d{2}[\/\-.年]\s*\d{1,2}[\/\-.月]\s*\d{1,2})/g
  ];
  const out = [];
  for (const re of regexes) {
    for (const m of safe.matchAll(re)) {
      const tok = normalizeDateToken(m[2] || m[1] || m[0]);
      if (tok) out.push(tok);
    }
  }
  return [...new Set(out)];
}
function uniqueHistory(rows) {
  const seen = new Set();
  return (rows || []).filter((row) => {
    const key = `${row.date}:${row.value}:${row.unit || ''}:${row.flag || ''}`;
    if (!row.date || !row.value || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
function looksLikeLabText(text) {
  return /検査結果|検査結果レポート|検査項目名|基準値|患者番号|LDL|HDL|HbA1c|血液検査|WBC|RBC|Hgb|Hct|PLT|TSH|FT4|FT3|尿酸|クレアチニン|eGFR/i.test(text || '');
}
function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const itemName = resolveCanonicalItem(item?.itemName || item?.name || '');
    const rawValue = normalizeText(item?.value || item?.currentValue || '').replace(/[^\d.\-]/g, '');
    const unit = normalizeUnit(item?.unit || item?.currentUnit || '');
    const flag = normalizeFlag(item?.flag || item?.currentFlag || '');
    if (!itemName) continue;
    const history = uniqueHistory(Array.isArray(item?.history) ? item.history.map((row) => ({
      date: normalizeDateToken(row?.date || ''),
      value: normalizeText(row?.value || '').replace(/[^\d.\-]/g, ''),
      unit: normalizeUnit(row?.unit || unit),
      flag: normalizeFlag(row?.flag || '')
    })) : []);
    if (!rawValue && !history.length) continue;
    const key = `${itemName}:${rawValue}:${unit}:${flag}`;
    if (seen.has(key) && !history.length) continue;
    seen.add(key);
    out.push({ itemName, value: rawValue, unit, flag, history });
  }
  return out;
}
function tryHeuristicExtract(rawText) {
  const safe = sanitizeGeminiText(rawText);
  const dateCandidates = extractDateCandidates(safe);
  const lines = safe.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const items = [];
  const seen = new Set();
  for (const line of lines) {
    const canonical = resolveCanonicalItem(line);
    if (!canonical) continue;
    const values = [...line.matchAll(/\b([HL])?\s*([0-9]+(?:\.[0-9]+)?)\b/g)];
    if (!values.length) continue;
    const unitMatch = line.match(/(mg\/dL|IU\/L|U\/L|%|pg|fL|x10|×10|10\^)/i);
    const unit = normalizeUnit(unitMatch?.[1] || '');
    const history = [];
    if (dateCandidates.length >= 2 && values.length >= 2) {
      const span = Math.min(dateCandidates.length, values.length);
      for (let i = 0; i < span; i += 1) {
        history.push({
          date: dateCandidates[dateCandidates.length - span + i],
          value: normalizeText(values[values.length - span + i][2] || '').replace(/[^\d.\-]/g, ''),
          unit,
          flag: normalizeFlag(values[values.length - span + i][1] || '')
        });
      }
    }
    const current = values[values.length - 1];
    const value = normalizeText(current[2] || '').replace(/[^\d.\-]/g, '');
    const flag = normalizeFlag(current[1] || '');
    const key = `${canonical}:${value}:${unit}:${flag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ itemName: canonical, value, unit, flag, history: uniqueHistory(history) });
  }
  return { examDate: dateCandidates.slice(-1)[0] || '', items };
}

async function analyzeLabImage(imagePayload) {
  const prompt = [
    'この画像が血液検査結果・健康診断結果・採血結果の表なら、表の項目名と数値をできるだけ正確にJSONで返してください。',
    '印刷日、検査日、採血日、受診日が見える場合は examDate に最新の実施日を優先して YYYY-MM-DD で入れてください。',
    '項目名は LDL, HDL, 中性脂肪, HbA1c, AST, ALT, γ-GTP, ALP, 尿酸, 血糖, クレアチニン, eGFR, 尿素窒素, LDH, CK, WBC, RBC, Hgb, Hct, PLT, TSH, FT4, FT3 から拾ってください。',
    'JSONのみを返してください。',
    '{',
    '  "isLabImage": true,',
    '  "examDate": "2025-03-24",',
    '  "items": [',
    '    { "itemName": "LDL", "value": "151", "unit": "mg/dL", "flag": "H", "history": [] }',
    '  ],',
    '  "confidence": 0.0',
    '}'
  ].join('\n');

  const result = await geminiImageAnalysisService.analyzeImage({ imagePayload, prompt });
  if (!result.ok) {
    return { source: 'image', isLabImage: false, examDate: '', items: [], confidence: 0 };
  }

  const parsed = extractJsonObject(result.text);
  const rawText = sanitizeGeminiText(result.text);
  const heuristic = tryHeuristicExtract(rawText);

  if (parsed) {
    const items = normalizeItems(parsed.items);
    const examDate = normalizeDateToken(parsed.examDate || '') || heuristic.examDate || extractDateCandidates(rawText).slice(-1)[0] || '';
    const mergedItems = items.length ? items : heuristic.items;
    return {
      source: 'image',
      isLabImage: Boolean(parsed.isLabImage || mergedItems.length || looksLikeLabText(rawText)),
      examDate,
      items: mergedItems,
      confidence: Number(parsed.confidence || (mergedItems.length ? 0.72 : 0.35)),
      rawText
    };
  }

  return {
    source: 'image',
    isLabImage: Boolean(heuristic.items.length || looksLikeLabText(rawText)),
    examDate: heuristic.examDate || extractDateCandidates(rawText).slice(-1)[0] || '',
    items: heuristic.items,
    confidence: heuristic.items.length ? 0.55 : 0.2,
    rawText
  };
}

module.exports = {
  analyzeLabImage
};
