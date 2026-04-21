'use strict';

const labDocumentIngestService = require('../../lab_document_ingest_service');
const labItemAliasService = require('../../lab_item_alias_service');
const labFollowupService = require('../../lab_followup_service');
const contextMemoryService = require('../../context_memory_service');
const activeContextService = require('../../active_context_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function hasTentativeLabSignal(lab = {}) {
  if (!lab || typeof lab !== 'object') return false;
  if (normalizeText(lab?.printDate || '')) return true;
  if (normalizeText(lab?.patientName || '')) return true;
  if (normalizeText(lab?.facilityName || '')) return true;
  if (Array.isArray(lab?.examDates) && lab.examDates.length) return true;
  if (Array.isArray(lab?.items) && lab.items.length) return true;
  if (normalizeText(lab?.rawText || '').length >= 20) return true;
  return false;
}

function buildLatestLabCache({ input, imagePayload, lab }) {
  const itemMap = {
    ...labItemAliasService.buildLabItemMapFromRawText(lab?.rawText || ''),
    ...labItemAliasService.buildLabItemMapFromPanel(lab || {}),
  };
  return {
    userId: input.userId,
    sourceImageId: normalizeText(imagePayload?.id || ''),
    sourceMessageId: normalizeText(input?.messageId || ''),
    examDate: lab?.latestExamDate || lab?.examDate || '',
    examDates: Array.isArray(lab?.examDates) ? lab.examDates : [],
    items: itemMap,
    rawText: normalizeText(lab?.rawText || ''),
    patientName: normalizeText(lab?.patientName || ''),
    facilityName: normalizeText(lab?.facilityName || ''),
    printDate: normalizeText(lab?.printDate || ''),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(),
  };
}

async function handleLabImageV2({ input, imagePayload }) {
  const ingest = await labDocumentIngestService.ingestLabDocument({ userId: input.userId, imagePayload });
  const lab = ingest?.panel || null;
  if (!lab) return { handled: false, reason: 'no_lab_panel', analysis: null };
  if (!lab?.isLabImage && !lab?.labLike && !hasTentativeLabSignal(lab)) {
    return { handled: false, reason: 'not_lab_like', analysis: lab };
  }

  const latestLabCache = buildLatestLabCache({ input, imagePayload, lab });
  const hasItems = Array.isArray(lab?.items) && lab.items.length > 0;
  await contextMemoryService.saveShortMemory(input.userId, {
    lastImageType: hasItems ? 'lab' : 'lab_pending',
    followUpContext: {
      source: 'image',
      imageType: hasItems ? 'lab' : 'lab_pending',
      intakeKind: lab?.intakeKind || 'lab_image',
      extractedItems: Array.isArray(lab?.items) ? lab.items : [],
      examDate: lab?.examDate || '',
      latestExamDate: lab?.latestExamDate || lab?.examDate || '',
      selectedLabExamDate: lab?.latestExamDate || lab?.examDate || '',
      availableLabDates: Array.isArray(lab?.examDates) ? lab.examDates : [],
      labPanel: lab || null,
      latestLabCache
    }
  });
  await contextMemoryService.upsertLabPanel(input.userId, lab).catch(() => null);
  await activeContextService.setActiveContext(input.userId, {
    type: hasItems ? 'lab_followup_session' : 'lab_image_session',
    payload: { labPanel: lab }
  });

  const replyText = labFollowupService.buildLabImageReply(lab);
  return { handled: true, analysis: lab, replyText, intentType: hasItems ? 'lab_image' : 'lab_image_pending' };
}

module.exports = {
  handleLabImageV2,
};
