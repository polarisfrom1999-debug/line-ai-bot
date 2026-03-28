services/record_persistence_service.js
'use strict';

const contextMemoryService = require('./context_memory_service');
const pointsService = require('./points_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function normalizeMealRecord(record) {
  return {
    type: 'meal',
    name: normalizeText(record?.name || record?.summary || '食事'),
    summary: normalizeText(record?.summary || record?.name || '食事'),
    estimatedNutrition: {
      kcal: round1(record?.estimatedNutrition?.kcal || record?.kcal || 0),
      protein: round1(record?.estimatedNutrition?.protein || record?.protein || 0),
      fat: round1(record?.estimatedNutrition?.fat || record?.fat || 0),
      carbs: round1(record?.estimatedNutrition?.carbs || record?.carbs || 0)
    },
    kcal: round1(record?.kcal || record?.estimatedNutrition?.kcal || 0),
    protein: round1(record?.protein || record?.estimatedNutrition?.protein || 0),
    fat: round1(record?.fat || record?.estimatedNutrition?.fat || 0),
    carbs: round1(record?.carbs || record?.estimatedNutrition?.carbs || 0),
    amountNote: normalizeText(record?.amountNote || ''),
    amountRatio: Number(record?.amountRatio || 1)
  };
}

function normalizeExerciseRecord(record) {
  return {
    type: 'exercise',
    name: normalizeText(record?.name || '運動'),
    summary: normalizeText(record?.summary || record?.name || '運動'),
    minutes: record?.minutes != null ? Number(record.minutes) : null,
    estimatedCalories: record?.estimatedCalories != null ? Number(record.estimatedCalories) : null
  };
}

function normalizeWeightRecord(record) {
  return {
    type: 'weight',
    summary: normalizeText(record?.summary || '体重記録'),
    weight: record?.weight != null ? Number(record.weight) : null,
    bodyFat: record?.bodyFat != null ? Number(record.bodyFat) : null
  };
}

function normalizeLabItem(item) {
  return {
    itemName: normalizeText(item?.itemName || item?.name || ''),
    value: normalizeText(item?.value || ''),
    unit: normalizeText(item?.unit || '')
  };
}

function normalizeLabRecord(record) {
  return {
    type: 'lab',
    summary: normalizeText(record?.summary || '血液検査'),
    examDate: normalizeText(record?.examDate || ''),
    items: (Array.isArray(record?.items) ? record.items : [])
      .map(normalizeLabItem)
      .filter((item) => item.itemName && item.value)
  };
}

function normalizeRecord(record) {
  if (!record?.type) return null;

  if (record.type === 'meal') return normalizeMealRecord(record);
  if (record.type === 'exercise') return normalizeExerciseRecord(record);
  if (record.type === 'weight') return normalizeWeightRecord(record);
  if (record.type === 'lab') return normalizeLabRecord(record);

  return null;
}

async function persistOneRecord(userId, record) {
  const normalized = normalizeRecord(record);
  if (!normalized) return null;

  await contextMemoryService.addDailyRecord(userId, normalized);

  const earnedPoints = pointsService.getPointValueByRecordType(normalized.type);
  const totalPoints = await contextMemoryService.addPoints(userId, earnedPoints);

  return {
    record: normalized,
    earnedPoints,
    totalPoints,
    pointMessage: pointsService.buildEarnedPointMessage(
      normalized.type,
      earnedPoints,
      totalPoints
    )
  };
}

async function persistRecords({ userId, recordPayloads }) {
  const payloads = Array.isArray(recordPayloads) ? recordPayloads : [];

  if (!userId || !payloads.length) {
    return {
      ok: true,
      savedCount: 0,
      saved: [],
      points: await contextMemoryService.getPoints(userId)
    };
  }

  const saved = [];
  let latestPoints = await contextMemoryService.getPoints(userId);

  for (const payload of payloads) {
    const persisted = await persistOneRecord(userId, payload);
    if (!persisted) continue;

    saved.push(persisted.record);
    latestPoints = persisted.totalPoints;
  }

  return {
    ok: true,
    savedCount: saved.length,
    saved,
    points: latestPoints
  };
}

module.exports = {
  persistRecords
};
