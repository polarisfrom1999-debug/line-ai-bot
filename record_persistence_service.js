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
  const nutrition = {
    kcal: round1(record?.estimatedNutrition?.kcal || record?.kcal || 0),
    protein: round1(record?.estimatedNutrition?.protein || record?.protein || 0),
    fat: round1(record?.estimatedNutrition?.fat || record?.fat || 0),
    carbs: round1(record?.estimatedNutrition?.carbs || record?.carbs || 0)
  };

  return {
    type: 'meal',
    name: normalizeText(record?.name || record?.summary || '食事'),
    summary: normalizeText(record?.summary || record?.name || '食事'),
    mealType: normalizeText(record?.mealType || ''),
    source: normalizeText(record?.source || ''),
    estimatedNutrition: nutrition,
    kcal: nutrition.kcal,
    protein: nutrition.protein,
    fat: nutrition.fat,
    carbs: nutrition.carbs,
    amountNote: normalizeText(record?.amountNote || ''),
    amountRatio: Number(record?.amountRatio || 1),
    items: Array.isArray(record?.items) ? record.items.filter(Boolean) : []
  };
}

function normalizeExerciseRecord(record) {
  return {
    type: 'exercise',
    name: normalizeText(record?.name || '運動'),
    exerciseType: normalizeText(record?.exerciseType || ''),
    summary: normalizeText(record?.summary || record?.name || '運動'),
    minutes: record?.minutes != null ? Number(record.minutes) : null,
    steps: record?.steps != null ? Number(record.steps) : null,
    distanceKm: record?.distanceKm != null ? Number(record.distanceKm) : null,
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
    unit: normalizeText(item?.unit || ''),
    flag: normalizeText(item?.flag || ''),
    history: Array.isArray(item?.history)
      ? item.history.map((row) => ({
          date: normalizeText(row?.date || ''),
          value: normalizeText(row?.value || ''),
          unit: normalizeText(row?.unit || ''),
          flag: normalizeText(row?.flag || '')
        })).filter((row) => row.date && row.value)
      : []
  };
}

function normalizeLabRecord(record) {
  return {
    type: 'lab',
    summary: normalizeText(record?.summary || '血液検査'),
    examDate: normalizeText(record?.examDate || ''),
    items: (Array.isArray(record?.items) ? record.items : [])
      .map(normalizeLabItem)
      .filter((item) => item.itemName && (item.value || item.history.length)),
    panels: Array.isArray(record?.panels)
      ? record.panels.map((panel) => ({
          examDate: normalizeText(panel?.examDate || ''),
          items: (Array.isArray(panel?.items) ? panel.items : []).map(normalizeLabItem).filter((item) => item.itemName && (item.value || item.history.length))
        })).filter((panel) => panel.examDate && panel.items.length)
      : []
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

function buildRecordDigest(record) {
  if (!record) return '';
  if (record.type === 'meal') {
    return ['meal', record.summary, record.kcal, record.protein, record.fat, record.carbs, record.amountRatio].join('|');
  }
  if (record.type === 'exercise') {
    return ['exercise', record.summary, record.minutes, record.steps, record.distanceKm, record.estimatedCalories].join('|');
  }
  if (record.type === 'weight') {
    return ['weight', record.summary, record.weight, record.bodyFat].join('|');
  }
  if (record.type === 'lab') {
    return ['lab', record.summary, record.examDate, (record.items || []).map((i) => `${i.itemName}:${i.value}${i.unit}`).join(',')].join('|');
  }
  return '';
}

function isDuplicateRecord(record, todayRecords) {
  const bucket = record?.type === 'meal'
    ? todayRecords?.meals
    : record?.type === 'exercise'
      ? todayRecords?.exercises
      : record?.type === 'weight'
        ? todayRecords?.weights
        : todayRecords?.labs;

  const digest = buildRecordDigest(record);
  return (Array.isArray(bucket) ? bucket : []).some((item) => buildRecordDigest(item) === digest);
}

async function persistOneRecord(userId, record) {
  const normalized = normalizeRecord(record);
  if (!normalized) return null;

  const todayRecords = await contextMemoryService.getTodayRecords(userId);
  if (isDuplicateRecord(normalized, todayRecords)) {
    return {
      record: normalized,
      earnedPoints: 0,
      totalPoints: await contextMemoryService.getPoints(userId),
      pointMessage: '',
      skippedAsDuplicate: true
    };
  }

  await contextMemoryService.addDailyRecord(userId, normalized);

  const earnedPoints = pointsService.getPointValueByRecordType(normalized.type);
  const totalPoints = await contextMemoryService.addPoints(userId, earnedPoints);

  return {
    record: normalized,
    earnedPoints,
    totalPoints,
    pointMessage: pointsService.buildEarnedPointMessage(normalized.type, earnedPoints, totalPoints),
    skippedAsDuplicate: false
  };
}

async function persistRecords({ userId, recordPayloads }) {
  const payloads = Array.isArray(recordPayloads) ? recordPayloads : [];

  if (!userId || !payloads.length) {
    return {
      ok: true,
      savedCount: 0,
      skippedCount: 0,
      saved: [],
      skipped: [],
      points: await contextMemoryService.getPoints(userId)
    };
  }

  const saved = [];
  const skipped = [];
  let latestPoints = await contextMemoryService.getPoints(userId);

  for (const payload of payloads) {
    const persisted = await persistOneRecord(userId, payload);
    if (!persisted) continue;

    latestPoints = persisted.totalPoints;
    if (persisted.skippedAsDuplicate) skipped.push(persisted.record);
    else saved.push(persisted.record);
  }

  return {
    ok: true,
    savedCount: saved.length,
    skippedCount: skipped.length,
    saved,
    skipped,
    points: latestPoints
  };
}

module.exports = {
  persistRecords,
  persistOneRecord,
  normalizeRecord
};
