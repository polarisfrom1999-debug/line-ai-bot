'use strict';

const geminiImageAnalysisService = require('./gemini_image_analysis_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizeGeminiText(text) {
  return normalizeText(text).replace(/```json/gi, '').replace(/```/g, '').trim();
}

function extractJsonObject(text) {
  const safe = sanitizeGeminiText(text);
  const start = safe.indexOf('{');
  const end = safe.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(safe.slice(start, end + 1));
  } catch (_error) {
    return null;
  }
}

function normalizeDateToken(token) {
  const safe = normalizeText(token);
  if (!safe) return '';
  const compact = safe.replace(/\s+/g, '');

  let m = safe.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = safe.match(/(20\d{2})[\/\.年]\s*(\d{1,2})[\/\.月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;

  // 20260314 / 2026.03.14 などの詰まった表記
  m = compact.match(/(20\d{2})[\/\.\-年]?(0?[1-9]|1[0-2])[\/\.\-月]?(0?[1-9]|[12]\d|3[01])日?/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;

  m = safe.match(/([0-9]{2})[\/\.\-]\s*(\d{1,2})[\/\.\-]\s*(\d{1,2})/);
  if (m) {
    const yy = Number(m[1]);
    const yyyy = coerceYearForLab(yy <= 39 ? 2000 + yy : 1900 + yy);
    return `${yyyy}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  m = safe.match(/R\s*(\d+)[\.\/\-](\d{1,2})[\.\/\-](\d{1,2})/i);
  if (m) {
    const year = coerceYearForLab(2018 + Number(m[1]));
    return `${year}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  // 採血日:24/03/14 のような2桁年
  m = safe.match(/([採検].{0,3}日)[^\d]{0,4}([0-9]{2})[\/\.\-年]\s*(\d{1,2})[\/\.\-月]\s*(\d{1,2})/);
  if (m) {
    const yy = Number(m[2]);
    const yyyy = coerceYearForLab(yy <= 39 ? 2000 + yy : 1900 + yy);
    return `${yyyy}-${String(m[3]).padStart(2, '0')}-${String(m[4]).padStart(2, '0')}`;
  }

  return '';
}

function isPlausibleLabYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return false;
  const now = new Date();
  const maxYear = now.getFullYear() + 1;
  return y >= 2000 && y <= maxYear;
}

function coerceYearForLab(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return null;
  if (isPlausibleLabYear(y)) return y;
  if (y >= 1900 && y <= 1999 && isPlausibleLabYear(y + 100)) return y + 100;
  if (y >= 2100 && isPlausibleLabYear(y - 100)) return y - 100;
  return y;
}

function uniqueSortedDates(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeDateToken).filter(Boolean))].sort();
}

function normalizeDocumentType(value) {
  const safe = normalizeText(value).toLowerCase();
  if (!safe) return 'unknown';
  if (safe.includes('chat') || safe.includes('screenshot')) return 'chat_screenshot';
  if (safe.includes('blood_lab_report') || safe.includes('blood_lab')) return 'multi_date_timeseries';
  if (safe.includes('multi')) return 'multi_date_timeseries';
  if (safe.includes('single')) return 'single_day_report';
  return 'unknown';
}

function buildPrompt() {
  return [
    'あなたは血液検査帳票の分類係です。説明文は不要、JSONのみで返してください。',
    '画像が血液検査帳票なら is_lab_document を true にし、帳票タイプを document_type に入れてください。',
    'document_type は次のどれかだけを使ってください。',
    '- "single_day_report"',
    '- "multi_date_timeseries"',
    '- "chat_screenshot"',
    '- "unknown"',
    '重要: LINEやチャット画面、吹き出し、スマホUI、共有ボタンが主役の画像は chat_screenshot にしてください。',
    'report_date には帳票の作成日や印刷日、exam_dates には結果列に対応する検査日だけを入れてください。',
    'exam_dates / latest_exam_date は「採血日」「検査日」「受診日」ラベル付きの日付を最優先で拾ってください（印刷日だけで埋めない）。',
    '{',
    '  "is_lab_document": true,',
    '  "document_type": "single_day_report",',
    '  "patient_name": "",',
    '  "report_date": "YYYY-MM-DD or empty",',
    '  "exam_dates": ["YYYY-MM-DD"],',
    '  "latest_exam_date": "YYYY-MM-DD or empty",',
    '  "issues": [""],',
    '  "confidence": 0.0',
    '}'
  ].join('\n');
}

async function classifyLabDocument(imagePayload) {
  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt: buildPrompt(),
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  });

  const json = extractJsonObject(result?.text || '') || {};
  const documentType = normalizeDocumentType(json.document_type || json.documentKind || '');
  const reportDate = normalizeDateToken(json.report_date || json.reportDate || '');
  const examDates = uniqueSortedDates(json.exam_dates || json.examDates || []);
  const latestExamDate = normalizeDateToken(json.latest_exam_date || json.latestExamDate || '') || examDates[examDates.length - 1] || reportDate || '';
  const patientName = normalizeText(json.patient_name || json.patientName || '');
  const issues = Array.isArray(json.issues) ? json.issues.map(normalizeText).filter(Boolean) : [];
  const confidence = Number(json.confidence || 0) || 0;
  const isLabDocument = Boolean(json.is_lab_document || json.isLabDocument || documentType === 'single_day_report' || documentType === 'multi_date_timeseries');

  return {
    ok: Boolean(result?.ok),
    isLabDocument,
    documentType,
    reportDate,
    examDates,
    latestExamDate,
    patientName,
    issues,
    confidence,
    rawText: sanitizeGeminiText(result?.text || '')
  };
}

function extractExamDateFromBlobText(text) {
  const safe = normalizeText(text);
  if (!safe) return '';
  const lines = safe.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const priorityLine = lines.find((line) => /採血日|検査日|受診日|実施日|採取日/.test(line));
  if (priorityLine) {
    const d = normalizeDateToken(priorityLine);
    if (d) return d;
  }
  for (const line of lines.slice(0, 25)) {
    const d = normalizeDateToken(line);
    if (d) return d;
  }
  return normalizeDateToken(safe);
}

module.exports = {
  classifyLabDocument,
  normalizeDateToken,
  normalizeDocumentType,
  uniqueSortedDates,
  sanitizeGeminiText,
  extractJsonObject,
  extractExamDateFromBlobText
};
