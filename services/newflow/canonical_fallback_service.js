'use strict';

const labSessionRepository = require('../../repositories/lab_session_repository');
const canonicalMealRepository = require('../../repositories/canonical_meal_repository');

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizeLabItems(items = []) {
  return (Array.isArray(items) ? items : []).map((it) => ({
    itemName: normalizeText(it?.itemName || it?.name || it?.name_normalized || ''),
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

function toLabPanel(labSession) {
  if (!labSession || typeof labSession !== 'object') return null;
  const dates = Array.isArray(labSession.exam_dates_json) ? labSession.exam_dates_json : [];
  return {
    patientName: normalizeText(labSession.patient_name || ''),
    facilityName: normalizeText(labSession.facility_name || ''),
    printDate: normalizeText(labSession.print_date || ''),
    examDates: dates,
    items: sanitizeLabItems(labSession.parsed_items_json),
    rawText: normalizeText(labSession.raw_text || ''),
    latestExamDate: dates.length ? String(dates[dates.length - 1] || '') : '',
  };
}

async function getCanonicalLabPanel(userId) {
  const latest = await labSessionRepository.getLatestLabSession(userId).catch(() => null);
  return toLabPanel(latest);
}

async function getCanonicalMeal(userId) {
  return canonicalMealRepository.getLatestCanonicalMeal(userId);
}

module.exports = {
  getCanonicalLabPanel,
  getCanonicalMeal,
};
