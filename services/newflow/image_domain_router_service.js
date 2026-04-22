'use strict';

const geminiDispatchService = require('../gemini_dispatch_service');

const IMAGE_DOMAIN_SCHEMA_VERSION = 'image-domain-v1';
const IMAGE_DOMAIN_CONFIDENCE_THRESHOLD = 0.5;
const IMAGE_DOMAIN_SCHEMA = {
  type: 'object',
  properties: {
    schema_version: { type: 'string' },
    domain: { type: 'string', enum: ['meal', 'lab', 'unknown'] },
    confidence: { type: 'number' },
    meal_evidence: {
      type: 'object',
      properties: {
        is_food_photo: { type: 'boolean' },
        dish_count: { type: 'number' },
        has_tableware_or_plate: { type: 'boolean' },
        nutrition_estimation_possible: { type: 'boolean' }
      },
      required: ['is_food_photo', 'dish_count', 'has_tableware_or_plate', 'nutrition_estimation_possible']
    },
    lab_evidence: {
      type: 'object',
      properties: {
        is_lab_report: { type: 'boolean' },
        has_test_item_rows: { type: 'boolean' },
        has_reference_range_or_units: { type: 'boolean' },
        has_exam_date_or_patient_fields: { type: 'boolean' }
      },
      required: ['is_lab_report', 'has_test_item_rows', 'has_reference_range_or_units', 'has_exam_date_or_patient_fields']
    },
    reason_codes: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' }
  },
  required: ['schema_version', 'domain', 'confidence', 'meal_evidence', 'lab_evidence', 'reason_codes', 'notes']
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

function sumMealEvidence(mealEvidence = {}) {
  return Number(Boolean(mealEvidence?.is_food_photo))
    + Number(Boolean(mealEvidence?.has_tableware_or_plate))
    + Number(Boolean(mealEvidence?.nutrition_estimation_possible))
    + (Number(mealEvidence?.dish_count || 0) > 0 ? 1 : 0);
}

function sumLabEvidence(labEvidence = {}) {
  return Number(Boolean(labEvidence?.is_lab_report))
    + Number(Boolean(labEvidence?.has_test_item_rows))
    + Number(Boolean(labEvidence?.has_reference_range_or_units))
    + Number(Boolean(labEvidence?.has_exam_date_or_patient_fields));
}

function buildPrompt() {
  return [
    'あなたは画像のドメイン判定専用モジュールです。',
    '画像を見て、meal / lab / unknown のいずれかを JSON で返してください。',
    'テキスト入力ヒントは使わず、画像情報のみで判定してください。',
    'meal は料理写真、lab は血液検査結果票、unknown はどちらとも判定できない場合のみ選択します。',
    '必ず schema_version=image-domain-v1 を含めてください。'
  ].join('\n');
}

function defaultUnknownDecision(rejectReason) {
  return {
    routeKind: 'unknown',
    confidence: 0,
    source: 'gemini_structured',
    candidateDomain: 'unknown',
    rejectReason,
    geminiResultPresent: false,
    adopted: false,
    evidence: { mealSignals: 0, labSignals: 0, schemaVersion: IMAGE_DOMAIN_SCHEMA_VERSION }
  };
}

function isValidDomain(value) {
  return value === 'meal' || value === 'lab' || value === 'unknown';
}

async function decideImageDomain({ imagePayload } = {}) {
  if (!imagePayload?.buffer && !imagePayload?.data && !imagePayload?.inlineData?.data) {
    return defaultUnknownDecision('gemini_error');
  }
  const gemini = await geminiDispatchService.generateStructuredImageJson({
    imagePayload,
    prompt: buildPrompt(),
    schema: IMAGE_DOMAIN_SCHEMA,
    domain: 'image_domain',
    temperature: 0,
    maxOutputTokens: 600
  });
  if (!gemini?.ok) {
    return defaultUnknownDecision('gemini_error');
  }

  const json = gemini?.json && typeof gemini.json === 'object' ? gemini.json : null;
  if (!json) {
    return { ...defaultUnknownDecision('schema_invalid'), geminiResultPresent: true };
  }
  const schemaVersion = normalizeText(json?.schema_version);
  const candidateDomain = normalizeText(json?.domain).toLowerCase();
  const confidence = normalizeConfidence(json?.confidence);
  const mealSignals = sumMealEvidence(json?.meal_evidence);
  const labSignals = sumLabEvidence(json?.lab_evidence);
  const schemaValid = schemaVersion === IMAGE_DOMAIN_SCHEMA_VERSION && isValidDomain(candidateDomain);
  if (!schemaValid) {
    return {
      routeKind: 'unknown',
      confidence,
      source: 'gemini_structured',
      candidateDomain: isValidDomain(candidateDomain) ? candidateDomain : 'unknown',
      rejectReason: 'schema_invalid',
      geminiResultPresent: true,
      adopted: false,
      evidence: { mealSignals, labSignals, schemaVersion: schemaVersion || IMAGE_DOMAIN_SCHEMA_VERSION }
    };
  }
  if (candidateDomain === 'unknown' || confidence < IMAGE_DOMAIN_CONFIDENCE_THRESHOLD) {
    return {
      routeKind: 'unknown',
      confidence,
      source: 'gemini_structured',
      candidateDomain,
      rejectReason: 'insufficient_evidence',
      geminiResultPresent: true,
      adopted: false,
      evidence: { mealSignals, labSignals, schemaVersion }
    };
  }
  return {
    routeKind: candidateDomain,
    confidence,
    source: 'gemini_structured',
    candidateDomain,
    rejectReason: '',
    geminiResultPresent: true,
    adopted: true,
    evidence: { mealSignals, labSignals, schemaVersion }
  };
}

module.exports = {
  decideImageDomain,
};
