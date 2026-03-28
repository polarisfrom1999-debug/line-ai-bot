'use strict';

const PLAN_LABELS = {
  free: '無料体験',
  light: 'ライト',
  standard: 'スタンダード',
  premium: 'プレミアム'
};

const PLAN_FEATURES = {
  [PLAN_LABELS.free]: {
    label: PLAN_LABELS.free,
    canUseMealPhoto: true,
    canUseMealText: true,
    canUseWeightRecord: true,
    canUseExerciseRecord: true,
    canUseLabImage: true,
    canUseDailySummary: true,
    canUseWeeklyReport: true,
    canUseMonthlyReport: false,
    canUsePoints: true,
    note: 'まずは使い心地を確かめながら、記録と会話の流れを整える体験用です。'
  },
  [PLAN_LABELS.light]: {
    label: PLAN_LABELS.light,
    canUseMealPhoto: true,
    canUseMealText: true,
    canUseWeightRecord: true,
    canUseExerciseRecord: true,
    canUseLabImage: true,
    canUseDailySummary: true,
    canUseWeeklyReport: true,
    canUseMonthlyReport: true,
    canUsePoints: true,
    note: '日々の記録と振り返りを無理なく続けたい人向けです。'
  },
  [PLAN_LABELS.standard]: {
    label: PLAN_LABELS.standard,
    canUseMealPhoto: true,
    canUseMealText: true,
    canUseWeightRecord: true,
    canUseExerciseRecord: true,
    canUseLabImage: true,
    canUseDailySummary: true,
    canUseWeeklyReport: true,
    canUseMonthlyReport: true,
    canUsePoints: true,
    note: '記録だけでなく、体調や生活背景も含めて整えていく伴走向けです。'
  },
  [PLAN_LABELS.premium]: {
    label: PLAN_LABELS.premium,
    canUseMealPhoto: true,
    canUseMealText: true,
    canUseWeightRecord: true,
    canUseExerciseRecord: true,
    canUseLabImage: true,
    canUseDailySummary: true,
    canUseWeeklyReport: true,
    canUseMonthlyReport: true,
    canUsePoints: true,
    note: 'より深く伴走しながら、生活・感情・健康管理をまとめて見ていく前提です。'
  }
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePlan(plan) {
  const safe = normalizeText(plan);
  if (!safe) return null;
  if (/無料/.test(safe)) return PLAN_LABELS.free;
  if (/ライト/.test(safe)) return PLAN_LABELS.light;
  if (/スタンダード/.test(safe)) return PLAN_LABELS.standard;
  if (/プレミアム/.test(safe)) return PLAN_LABELS.premium;
  return safe;
}

function getPlanFeatures(plan) {
  const normalized = normalizePlan(plan);
  return PLAN_FEATURES[normalized] || PLAN_FEATURES[PLAN_LABELS.free];
}

function pickPlanFromText(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  const numericMap = {
    '1': PLAN_LABELS.free,
    '2': PLAN_LABELS.light,
    '3': PLAN_LABELS.standard,
    '4': PLAN_LABELS.premium
  };
  if (numericMap[safe]) return numericMap[safe];
  return normalizePlan(safe);
}

function canUseFeature(plan, featureKey) {
  const features = getPlanFeatures(plan);
  return Boolean(features?.[featureKey]);
}

function buildPlanGuide(plan) {
  const features = getPlanFeatures(plan);
  const enabledLabels = [
    features.canUseMealPhoto ? '食事写真' : null,
    features.canUseMealText ? '食事文字' : null,
    features.canUseWeightRecord ? '体重' : null,
    features.canUseExerciseRecord ? '運動' : null,
    features.canUseLabImage ? '血液検査' : null,
    features.canUseDailySummary ? '日次まとめ' : null,
    features.canUseWeeklyReport ? '週次まとめ' : null,
    features.canUseMonthlyReport ? '月次まとめ' : null,
    features.canUsePoints ? 'ポイント' : null
  ].filter(Boolean);

  return [
    `${features.label}プランです。`,
    features.note,
    enabledLabels.length ? `使える主な機能: ${enabledLabels.join(' / ')}` : '使える主な機能は準備中です。'
  ].join('\n');
}

module.exports = {
  PLAN_LABELS,
  PLAN_FEATURES,
  normalizePlan,
  getPlanFeatures,
  pickPlanFromText,
  canUseFeature,
  buildPlanGuide
};
