'use strict';

const classifierService = require('./lab_document_classifier_service');
const extractService = require('./lab_structured_extract_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function buildPendingPanel(classification, extraction) {
  const reportDate = classification?.reportDate || extraction?.reportDate || '';
  const examDates = Array.isArray(classification?.examDates) && classification.examDates.length
    ? classification.examDates
    : (Array.isArray(extraction?.examDates) ? extraction.examDates : []);
  const latestExamDate = classification?.latestExamDate || extraction?.latestExamDate || examDates[examDates.length - 1] || reportDate || '';
  const documentKind = normalizeText(classification?.documentType || extraction?.documentType || 'unknown');
  const issues = [
    ...(Array.isArray(classification?.issues) ? classification.issues : []),
    ...(Array.isArray(extraction?.issues) ? extraction.issues : [])
  ].map(normalizeText).filter(Boolean);

  return {
    source: 'image',
    isLabImage: documentKind !== 'chat_screenshot' && documentKind !== 'unknown',
    labLike: documentKind !== 'chat_screenshot' && documentKind !== 'unknown',
    reportDate,
    examDate: latestExamDate,
    latestExamDate,
    examDates,
    availableDates: examDates,
    documentKind,
    patientName: normalizeText(classification?.patientName || extraction?.patientName || ''),
    items: Array.isArray(extraction?.items) ? extraction.items : [],
    structuredRows: Array.isArray(extraction?.rows) ? extraction.rows : [],
    issues,
    confidence: Number(extraction?.confidence || classification?.confidence || 0) || 0.3,
    trendSummary: '',
    rawText: [classification?.rawText, extraction?.rawText].filter(Boolean).join('\n'),
    rawPayload: extraction?.rawPayload || null,
    promptVersion: extraction?.promptVersion || '',
    ignoredReason: '',
    labPending: true
  };
}

function buildIgnoredPanel(reason, classification) {
  return {
    source: 'image',
    isLabImage: false,
    labLike: false,
    reportDate: '',
    examDate: '',
    latestExamDate: '',
    examDates: [],
    availableDates: [],
    documentKind: normalizeText(classification?.documentType || 'unknown'),
    patientName: '',
    items: [],
    structuredRows: [],
    issues: Array.isArray(classification?.issues) ? classification.issues : [],
    confidence: Number(classification?.confidence || 0) || 0.1,
    trendSummary: '',
    rawText: normalizeText(classification?.rawText || ''),
    ignoredReason: reason || 'unknown'
  };
}

function buildTrendSummary(panel) {
  const highlights = [];
  const items = Array.isArray(panel?.items) ? panel.items : [];
  const pick = (name) => items.find((item) => item?.itemName === name && item?.value);
  const tg = pick('中性脂肪');
  const hba1c = pick('HbA1c');
  const ldl = pick('LDL');
  const ast = pick('AST');

  if (tg) highlights.push(`中性脂肪 ${tg.value}${tg.unit ? ` ${tg.unit}` : ''}${tg.flag ? ` ${tg.flag}` : ''}`);
  if (hba1c) highlights.push(`HbA1c ${hba1c.value}${hba1c.unit ? ` ${hba1c.unit}` : ''}${hba1c.flag ? ` ${hba1c.flag}` : ''}`);
  if (ldl) highlights.push(`LDL ${ldl.value}${ldl.unit ? ` ${ldl.unit}` : ''}${ldl.flag ? ` ${ldl.flag}` : ''}`);
  if (ast) highlights.push(`AST ${ast.value}${ast.unit ? ` ${ast.unit}` : ''}${ast.flag ? ` ${ast.flag}` : ''}`);
  return highlights.join(' / ');
}

async function analyzeLabImage(imagePayload) {
  const classification = await classifierService.classifyLabDocument(imagePayload);
  const documentKind = normalizeText(classification.documentType || 'unknown');

  if (documentKind === 'chat_screenshot') {
    return buildIgnoredPanel('chat_screenshot', classification);
  }

  if (!classification.isLabDocument && documentKind === 'unknown') {
    return buildIgnoredPanel('not_lab_document', classification);
  }

  const extraction = await extractService.extractStructuredLab(imagePayload, classification);

  if (documentKind === 'chat_screenshot' || normalizeText(extraction.documentType || '') === 'chat_screenshot') {
    return buildIgnoredPanel('chat_screenshot', classification);
  }

  if (!Array.isArray(extraction.items) || !extraction.items.length) {
    return buildPendingPanel(classification, extraction);
  }

  const examDates = Array.isArray(extraction.examDates) ? extraction.examDates : [];
  const latestExamDate = extraction.latestExamDate || examDates[examDates.length - 1] || extraction.reportDate || classification.latestExamDate || '';
  const panel = {
    source: 'image',
    isLabImage: true,
    labLike: true,
    reportDate: extraction.reportDate || classification.reportDate || '',
    examDate: latestExamDate,
    latestExamDate,
    examDates,
    availableDates: examDates,
    documentKind: normalizeText(extraction.documentType || classification.documentType || 'unknown'),
    patientName: normalizeText(extraction.patientName || classification.patientName || ''),
    items: extraction.items,
    structuredRows: extraction.rows,
    issues: extraction.issues || classification.issues || [],
    confidence: Number(extraction.confidence || classification.confidence || 0) || 0.85,
    trendSummary: buildTrendSummary({ items: extraction.items }),
    rawText: [classification.rawText, extraction.rawText].filter(Boolean).join('\n'),
    rawPayload: extraction?.rawPayload || null,
    promptVersion: extraction?.promptVersion || ''
  };

  return panel;
}

module.exports = {
  analyzeLabImage
};
