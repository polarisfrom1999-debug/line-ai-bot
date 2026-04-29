'use strict';

const labSessionRepository = require('../../repositories/lab_session_repository');
const canonicalMealRepository = require('../../repositories/canonical_meal_repository');
const phaseeReachabilityService = require('../phasee_reachability_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizeLabItems(items = []) {
  return (Array.isArray(items) ? items : []).map((it) => ({
    itemName: normalizeText(it?.itemName || it?.name || it?.name_normalized || ''),
    normalizedKey: normalizeText(it?.normalizedKey || ''),
    source: normalizeText(it?.source || ''),
    rawName: normalizeText(it?.rawName || ''),
    value: normalizeText(it?.value || ''),
    unit: normalizeText(it?.unit || ''),
    flag: normalizeText(it?.flag || ''),
    history: Array.isArray(it?.history) ? it.history.map((h) => ({
      date: normalizeText(h?.date || ''),
      value: normalizeText(h?.value || ''),
      unit: normalizeText(h?.unit || ''),
      flag: normalizeText(h?.flag || ''),
    })) : []
  }));
}

function parseLabMetaFromGeminiRaw(geminiRaw) {
  if (geminiRaw == null) return { metaAdoption: null, metaExtraction: null, metaConfidence: null };
  let obj = geminiRaw;
  if (typeof geminiRaw === 'string') {
    try {
      obj = JSON.parse(geminiRaw);
    } catch (_e) {
      return { metaAdoption: null, metaExtraction: null, metaConfidence: null };
    }
  }
  if (!obj || typeof obj !== 'object') return { metaAdoption: null, metaExtraction: null, metaConfidence: null };
  const block = obj.lab_meta || obj.labMeta;
  if (!block || typeof block !== 'object') return { metaAdoption: null, metaExtraction: null, metaConfidence: null };
  return {
    metaAdoption: block.metaAdoption || null,
    metaExtraction: block.metaExtraction || null,
    metaConfidence: block.metaConfidence || null
  };
}

function toLabPanel(labSession) {
  if (!labSession || typeof labSession !== 'object') return null;
  const dates = Array.isArray(labSession.exam_dates_json) ? labSession.exam_dates_json : [];
  const patientName = normalizeText(labSession.patient_name || '');
  const facilityName = normalizeText(labSession.facility_name || '');
  const printDate = normalizeText(labSession.print_date || '');
  const { metaAdoption, metaExtraction, metaConfidence } = parseLabMetaFromGeminiRaw(
    labSession.gemini_raw
  );
  return {
    sourceSessionId: labSession.id || null,
    patientName,
    facilityName,
    printDate,
    meta: {
      patientName,
      facilityName,
      printDate
    },
    metaAdoption: metaAdoption || null,
    metaExtraction: metaExtraction || null,
    metaConfidence: metaConfidence || null,
    examDates: dates,
    items: sanitizeLabItems(labSession.parsed_items_json),
    rawText: normalizeText(labSession.raw_text || ''),
    latestExamDate: dates.length ? String(dates[dates.length - 1] || '') : '',
  };
}

async function getCanonicalLabPanel(userId, { logReachability = true } = {}) {
  const latest = await labSessionRepository.getLatestLabSession(userId).catch(() => null);
  if (logReachability) {
    console.info('[phasee-new] canonical_lab_reached', { userId: normalizeText(userId), found: Boolean(latest?.id) });
    phaseeReachabilityService.recordReachability('canonical_lab_reached', ['services/newflow/canonical_fallback_service.js'], {
      userId: normalizeText(userId),
      found: Boolean(latest?.id)
    }).catch(() => null);
  }
  return toLabPanel(latest);
}

async function getCanonicalMeal(userId) {
  const meal = await canonicalMealRepository.getLatestCanonicalMeal(userId);
  console.info('[phasee-new] canonical_meal_reached', { userId: normalizeText(userId), found: Boolean(meal?.id) });
  phaseeReachabilityService.recordReachability('canonical_meal_reached', ['services/newflow/canonical_fallback_service.js'], {
    userId: normalizeText(userId),
    found: Boolean(meal?.id)
  }).catch(() => null);
  return meal;
}

module.exports = {
  getCanonicalLabPanel,
  getCanonicalMeal,
};
