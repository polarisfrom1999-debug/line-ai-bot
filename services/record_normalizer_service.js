'use strict';

/**
 * services/record_normalizer_service.js
 *
 * 役割:
 * - 候補を保存向けの正規形へ整える
 */

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(value).toISOString().slice(0, 10);
}

function extractFirstNumber(text) {
  const match = normalizeText(text).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeMeal(candidate) {
  const extracted = candidate.extracted || {};
  const mealType = extracted.mealType || (/朝/.test(candidate.rawText) ? 'breakfast' : /昼/.test(candidate.rawText) ? 'lunch' : /夜|夕/.test(candidate.rawText) ? 'dinner' : 'unknown');
  return {
    recordType: 'meal',
    eventDate: normalizeDate(candidate.eventDate),
    mealType,
    itemsText: normalizeText(extracted.itemsText || candidate.rawText),
    amountNote: extracted.amountNote || null,
    source: candidate.source || 'text'
  };
}

function normalizeWeight(candidate) {
  const text = normalizeText(candidate.extracted?.valueText || candidate.rawText);
  return {
    recordType: 'weight',
    eventDate: normalizeDate(candidate.eventDate),
    weightKg: extractFirstNumber(text),
    rawValueText: text,
    source: candidate.source || 'text'
  };
}

function normalizeExercise(candidate) {
  const text = normalizeText(candidate.extracted?.valueText || candidate.rawText);
  const minutesMatch = text.match(/(\d+)\s*分/);
  const kmMatch = text.match(/(\d+(?:\.\d+)?)\s*(km|キロ)/i);
  return {
    recordType: 'exercise',
    eventDate: normalizeDate(candidate.eventDate),
    activityText: text,
    durationMinutes: minutesMatch ? Number(minutesMatch[1]) : null,
    distanceKm: kmMatch ? Number(kmMatch[1]) : null,
    source: candidate.source || 'text'
  };
}

function normalizeLab(candidate) {
  const text = normalizeText(candidate.extracted?.valueText || candidate.rawText);
  const items = [];
  const patterns = [
    { name: 'LDL', regex: /LDL\s*[:：]?\s*(\d+(?:\.\d+)?)/i },
    { name: 'HDL', regex: /HDL\s*[:：]?\s*(\d+(?:\.\d+)?)/i },
    { name: '中性脂肪', regex: /中性脂肪\s*[:：]?\s*(\d+(?:\.\d+)?)/i },
    { name: 'AST', regex: /AST\s*[:：]?\s*(\d+(?:\.\d+)?)/i },
    { name: 'ALT', regex: /ALT\s*[:：]?\s*(\d+(?:\.\d+)?)/i },
    { name: 'HbA1c', regex: /HbA1c\s*[:：]?\s*(\d+(?:\.\d+)?)/i }
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (match) {
      items.push({ itemName: pattern.name, value: Number(match[1]) });
    }
  }

  return {
    recordType: 'lab',
    eventDate: normalizeDate(candidate.eventDate),
    rawValueText: text,
    items,
    source: candidate.source || 'text'
  };
}

function normalizeProfile(candidate) {
  return {
    recordType: 'profile',
    eventDate: normalizeDate(candidate.eventDate),
    profileText: normalizeText(candidate.extracted?.valueText || candidate.rawText),
    source: candidate.source || 'text'
  };
}

function normalizeCandidate(candidate) {
  if (!candidate || !candidate.recordType) return null;
  switch (candidate.recordType) {
    case 'meal': return normalizeMeal(candidate);
    case 'weight': return normalizeWeight(candidate);
    case 'exercise': return normalizeExercise(candidate);
    case 'lab': return normalizeLab(candidate);
    case 'profile': return normalizeProfile(candidate);
    default:
      return {
        recordType: candidate.recordType,
        eventDate: normalizeDate(candidate.eventDate),
        rawValueText: normalizeText(candidate.rawText),
        source: candidate.source || 'text'
      };
  }
}

module.exports = {
  normalizeCandidate,
  normalizeMeal,
  normalizeWeight,
  normalizeExercise,
  normalizeLab,
  normalizeProfile
};
