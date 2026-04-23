'use strict';

const classifier = require('./lab_document_classifier_service');
const geminiDispatchService = require('./gemini_dispatch_service');
const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildLabMetaPrompt } = require('./lab_extract_prompt_builder_service');

const DEFAULT_HIGH_CONFIDENCE = Number(process.env.LAB_META_HIGH_CONFIDENCE || 0.75);

function normalizeText(value) {
  return String(value || '').trim();
}

function toConfidence(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeDate(value) {
  return normalizeText(classifier.normalizeDateToken(value || ''));
}

function emptyMeta() {
  return {
    patient_name: '',
    facility_name: '',
    print_date: '',
    patient_name_confidence: 0,
    facility_name_confidence: 0,
    print_date_confidence: 0,
  };
}

function fromExtractionPayload(payload = {}) {
  const obj = payload && typeof payload === 'object' ? payload : {};
  const patientName = normalizeText(
    obj.patient_name
      || obj.patientName
      || obj.patient?.name
      || obj.meta?.patient_name
      || obj.meta?.patientName
  );
  const facilityName = normalizeText(
    obj.facility_name
      || obj.facilityName
      || obj.hospital_name
      || obj.clinic_name
      || obj.meta?.facility_name
      || obj.meta?.facilityName
  );
  const printDate = normalizeDate(
    obj.print_date
      || obj.printDate
      || obj.report_date
      || obj.reportDate
      || obj.issued_date
      || obj.meta?.print_date
      || obj.meta?.printDate
  );

  const patientConf = toConfidence(
    obj.patient_name_confidence
      || obj.patientNameConfidence
      || obj.patient?.confidence
      || obj.meta?.patient_name_confidence
      || obj.meta?.patientNameConfidence
      || obj.confidence
  );
  const facilityConf = toConfidence(
    obj.facility_name_confidence
      || obj.facilityNameConfidence
      || obj.facility?.confidence
      || obj.meta?.facility_name_confidence
      || obj.meta?.facilityNameConfidence
      || obj.confidence
  );
  const printDateConf = toConfidence(
    obj.print_date_confidence
      || obj.printDateConfidence
      || obj.print_date_meta_confidence
      || obj.meta?.print_date_confidence
      || obj.meta?.printDateConfidence
      || obj.confidence
  );

  return {
    patient_name: patientName,
    facility_name: facilityName,
    print_date: printDate,
    patient_name_confidence: patientName ? patientConf : 0,
    facility_name_confidence: facilityName ? facilityConf : 0,
    print_date_confidence: printDate ? printDateConf : 0,
  };
}

function rescueMetaFromText(text = '') {
  const safe = normalizeText(text);
  if (!safe) return emptyMeta();
  const out = emptyMeta();

  const patientMatch = safe.match(/(?:患者(?:氏名|名)?|氏名|patient\s*name)\s*[:：]\s*([^\n\r,、]+)/i);
  if (patientMatch) {
    out.patient_name = normalizeText(patientMatch[1]);
    out.patient_name_confidence = out.patient_name ? 0.55 : 0;
  }

  const facilityMatch = safe.match(/(?:医療機関|病院名|医院名|クリニック名|facility(?:\s*name)?)\s*[:：]\s*([^\n\r,、]+)/i);
  if (facilityMatch) {
    out.facility_name = normalizeText(facilityMatch[1]);
    out.facility_name_confidence = out.facility_name ? 0.55 : 0;
  }

  const printDateMatch = safe.match(/(?:印刷日|発行日|報告日|print\s*date)\s*[:：]\s*([0-9]{2,4}[\/\-\.年][0-9]{1,2}[\/\-\.月][0-9]{1,2})/i);
  if (printDateMatch) {
    out.print_date = normalizeDate(printDateMatch[1]);
    out.print_date_confidence = out.print_date ? 0.55 : 0;
  }

  return out;
}

function pickMetaValue(incomingValue, incomingConfidence, canonicalValue, highThreshold) {
  const incoming = normalizeText(incomingValue);
  const canonical = normalizeText(canonicalValue);
  const conf = toConfidence(incomingConfidence, 0);
  if (!incoming) {
    return { value: canonical, adopted: false, source: 'empty_no_overwrite', confidence: canonical ? conf : 0 };
  }
  if (conf >= highThreshold) {
    return { value: incoming, adopted: true, source: 'incoming_high_confidence', confidence: conf };
  }
  return { value: canonical, adopted: false, source: canonical ? 'canonical_kept' : 'empty_no_overwrite', confidence: conf };
}

function mergeMetaWithCanonical({ extracted = {}, canonical = {}, highConfidenceThreshold = DEFAULT_HIGH_CONFIDENCE } = {}) {
  const next = fromExtractionPayload(extracted);
  const base = fromExtractionPayload({
    patient_name: canonical?.patient_name || canonical?.patientName || '',
    facility_name: canonical?.facility_name || canonical?.facilityName || '',
    print_date: canonical?.print_date || canonical?.printDate || '',
    patient_name_confidence: canonical?.patient_name_confidence || canonical?.patientNameConfidence || 0,
    facility_name_confidence: canonical?.facility_name_confidence || canonical?.facilityNameConfidence || 0,
    print_date_confidence: canonical?.print_date_confidence || canonical?.printDateConfidence || 0,
  });

  const patient = pickMetaValue(next.patient_name, next.patient_name_confidence, base.patient_name, highConfidenceThreshold);
  const facility = pickMetaValue(next.facility_name, next.facility_name_confidence, base.facility_name, highConfidenceThreshold);
  const printDate = pickMetaValue(next.print_date, next.print_date_confidence, base.print_date, highConfidenceThreshold);

  return {
    patient_name: patient.value,
    facility_name: facility.value,
    print_date: printDate.value,
    patient_name_confidence: next.patient_name_confidence,
    facility_name_confidence: next.facility_name_confidence,
    print_date_confidence: next.print_date_confidence,
    adoption: {
      patient_name: patient.source,
      facility_name: facility.source,
      print_date: printDate.source,
      high_confidence_threshold: highConfidenceThreshold,
    }
  };
}

async function extractMetaFromImage(imagePayload, meta = {}) {
  const promptSpec = buildLabMetaPrompt(meta);
  let payload = {};
  let rawText = '';
  let source = 'prompt_json';
  try {
    const dispatch = await geminiDispatchService.generateStructuredImageJson({
      imagePayload,
      prompt: promptSpec.prompt,
      schema: promptSpec.schema,
      domain: promptSpec.domain,
      model: promptSpec.preferredModel,
      temperature: promptSpec.temperature,
      maxOutputTokens: 1200
    });
    if (!dispatch?.ok) throw new Error(dispatch?.error?.message || 'meta_dispatch_failed');
    payload = dispatch.json || {};
    rawText = normalizeText(dispatch.text || '');
  } catch (_error) {
    source = 'raw_text_fallback';
    const fallback = await geminiImageAnalysisService.analyzeImage({
      imagePayload,
      prompt: promptSpec.prompt,
      model: promptSpec.preferredModel
    }).catch(() => null);
    rawText = normalizeText(fallback?.text || '');
    payload = {};
  }
  const fromPrompt = fromExtractionPayload(payload);
  const fromText = rescueMetaFromText(rawText);
  return {
    source,
    promptVersion: promptSpec.promptVersion,
    fromPrompt,
    fromText,
    mergedDraft: {
      patient_name: normalizeText(fromPrompt.patient_name || fromText.patient_name),
      facility_name: normalizeText(fromPrompt.facility_name || fromText.facility_name),
      print_date: normalizeDate(fromPrompt.print_date || fromText.print_date),
      patient_name_confidence: Math.max(toConfidence(fromPrompt.patient_name_confidence), toConfidence(fromText.patient_name_confidence)),
      facility_name_confidence: Math.max(toConfidence(fromPrompt.facility_name_confidence), toConfidence(fromText.facility_name_confidence)),
      print_date_confidence: Math.max(toConfidence(fromPrompt.print_date_confidence), toConfidence(fromText.print_date_confidence)),
    },
    rawText,
    rawPayload: payload
  };
}

module.exports = {
  DEFAULT_HIGH_CONFIDENCE,
  emptyMeta,
  fromExtractionPayload,
  rescueMetaFromText,
  mergeMetaWithCanonical,
  extractMetaFromImage,
};

