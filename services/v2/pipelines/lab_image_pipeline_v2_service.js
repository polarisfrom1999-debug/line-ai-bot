'use strict';

const labDocumentIngestService = require('../../lab_document_ingest_service');
const labItemAliasService = require('../../lab_item_alias_service');
const labFollowupService = require('../../lab_followup_service');
const contextMemoryService = require('../../context_memory_service');
const activeContextService = require('../../active_context_service');
const labSessionRepository = require('../../../repositories/lab_session_repository');
const labTentativeEscalation = require('../lab_tentative_escalation_service');

function normalizeText(value) {
  return String(value || '').trim();
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
  if (!labTentativeEscalation.shouldAcceptTentativeLabSession(lab)) {
    return { handled: false, reason: 'not_lab_like', analysis: lab };
  }

  const promotionSignals = labTentativeEscalation.getTentativePromotionSignals(lab);
  if (promotionSignals.reasons.length) {
    console.info('[v2-lab] tentative_promotion', {
      userId: input.userId,
      reasons: promotionSignals.reasons,
    });
  }

  const latestLabCache = buildLatestLabCache({ input, imagePayload, lab });
  const rawText = normalizeText(lab?.rawText || '');
  const rawMap = labItemAliasService.buildLabItemMapFromRawText(rawText);
  const candidateItemNamesCount = Math.max(
    Array.isArray(lab?.items) ? lab.items.length : 0,
    Object.keys(rawMap || {}).length
  );
  const candidateExamDatesCount = Array.isArray(lab?.examDates) ? lab.examDates.length : 0;
  const patientNameDetected = Boolean(normalizeText(lab?.patientName || ''));
  const facilityNameDetected = Boolean(normalizeText(lab?.facilityName || ''));
  const printDateDetected = Boolean(normalizeText(lab?.printDate || ''));
  console.info('[v2-lab] extraction_minimums', {
    userId: input.userId,
    extracted_text_length: rawText.length,
    candidate_exam_dates_count: candidateExamDatesCount,
    candidate_item_names_count: candidateItemNamesCount,
    patient_name_detected: patientNameDetected,
    facility_name_detected: facilityNameDetected,
    print_date_detected: printDateDetected,
  });

  const hasItems = Array.isArray(lab?.items) && lab.items.length > 0;
  const persist = await labSessionRepository.createLabSession({
    userId: input.userId,
    sourceImageId: normalizeText(imagePayload?.id || ''),
    sourceMessageId: normalizeText(input?.messageId || ''),
    status: hasItems ? 'active' : 'tentative',
    patientName: lab?.patientName || '',
    facilityName: lab?.facilityName || '',
    printDate: lab?.printDate || '',
    examDates: Array.isArray(lab?.examDates) ? lab.examDates : [],
    parsedItems: Array.isArray(lab?.itemsStructured) ? lab.itemsStructured : (Array.isArray(lab?.items) ? lab.items : []),
    rawText: lab?.rawText || '',
    confidence: Number(lab?.analysisConfidence?.v2_confidence || 0) || 0,
    isLabImageStrict: Boolean(lab?.isLabImage),
    isLabImageTentative: Boolean(
      lab?.labLike
        || labTentativeEscalation.shouldAcceptTentativeLabSession(lab)
        || rawText.length > 0
        || candidateItemNamesCount > 0
        || candidateExamDatesCount > 0
        || printDateDetected
        || patientNameDetected
        || facilityNameDetected
    ),
    expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(),
  }).catch(() => ({ ok: false, reason: 'insert_exception' }));

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

  const replyBase = labFollowupService.buildLabImageReply(lab);
  const replyText = persist?.ok
    ? replyBase
    : [replyBase, '', '※画像の読み取り結果は受け取りましたが、保存確認が未完了です。続けて「TGは？」「患者名は？」で確認できます。'].join('\n');
  return {
    handled: true,
    analysis: lab,
    replyText,
    intentType: hasItems ? 'lab_image' : 'lab_image_pending',
    persistence: { labSessionSaved: Boolean(persist?.ok), reason: persist?.reason || '' }
  };
}

module.exports = {
  handleLabImageV2,
};
