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

  let m = safe.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = safe.match(/(20\d{2})[\/\.年]\s*(\d{1,2})[\/\.月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;

  m = safe.match(/([0-9]{2})[\/\.\-]\s*(\d{1,2})[\/\.\-]\s*(\d{1,2})/);
  if (m) {
    const yy = Number(m[1]);
    const yyyy = yy <= 39 ? 2000 + yy : 1900 + yy;
    return `${yyyy}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  m = safe.match(/R\s*(\d+)[\.\/\-](\d{1,2})[\.\/\-](\d{1,2})/i);
  if (m) {
    const year = 2018 + Number(m[1]);
    return `${year}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  return '';
}

function uniqueSortedDates(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeDateToken).filter(Boolean))].sort();
}

function normalizeDocumentType(value) {
  const safe = normalizeText(value).toLowerCase();
  if (!safe) return 'unknown';
  if (safe.includes('chat') || safe.includes('screenshot')) return 'chat_screenshot';
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

module.exports = {
  classifyLabDocument,
  normalizeDateToken,
  normalizeDocumentType,
  uniqueSortedDates,
  sanitizeGeminiText,
  extractJsonObject
};
