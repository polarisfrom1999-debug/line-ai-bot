'use strict';

const POINT_RULES = {
  meal: 1,
  exercise: 1,
  weight: 1,
  lab: 2,
  weeklySurvey: 3,
  monthlySurvey: 5
};

function normalizeText(value) {
  return String(value || '').trim();
}

function clampNumber(value, min = 0, max = 999999) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function getPointValueByRecordType(type) {
  return clampNumber(POINT_RULES[normalizeText(type)] || 0);
}

function buildPointSummary(totalPoints) {
  const safePoints = clampNumber(totalPoints);
  if (safePoints >= 200) return `現在のポイントは ${safePoints}pt です。かなりしっかり積み上がっています。`;
  if (safePoints >= 100) return `現在のポイントは ${safePoints}pt です。継続の流れがちゃんと形になっています。`;
  if (safePoints >= 30) return `現在のポイントは ${safePoints}pt です。少しずつ積み上がってきています。`;
  return `現在のポイントは ${safePoints}pt です。ここから少しずつ積み上げていければ十分です。`;
}

function buildEarnedPointMessage(recordType, earnedPoints, totalPoints) {
  const safeEarned = clampNumber(earnedPoints);
  const safeTotal = clampNumber(totalPoints);
  if (safeEarned <= 0) return buildPointSummary(safeTotal);

  const labels = {
    meal: '食事記録',
    exercise: '運動記録',
    weight: '体重記録',
    lab: '血液検査記録',
    weeklySurvey: '1週間アンケート',
    monthlySurvey: '1か月アンケート'
  };

  const label = labels[normalizeText(recordType)] || '記録';
  return `${label}で ${safeEarned}pt 加算しました。現在 ${safeTotal}pt です。`;
}

function calculatePointsFromRecords(records) {
  return (Array.isArray(records) ? records : []).reduce((sum, record) => sum + getPointValueByRecordType(record?.type || ''), 0);
}

function classifyRecordTypeFromPayload(record) {
  const safe = normalizeText(record?.type || record?.recordType || '');
  if (safe) return safe;
  if (record?.estimatedNutrition || record?.mealType) return 'meal';
  if (record?.estimatedCalories || record?.minutes || record?.steps) return 'exercise';
  if (record?.weight || record?.bodyFat) return 'weight';
  if (Array.isArray(record?.items) && record.items.length) return 'lab';
  return 'unknown';
}

module.exports = {
  POINT_RULES,
  getPointValueByRecordType,
  buildPointSummary,
  buildEarnedPointMessage,
  calculatePointsFromRecords,
  classifyRecordTypeFromPayload
};
