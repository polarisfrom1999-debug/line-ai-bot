services/plan_service.js
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
    note: 'まずは使い心地を試しながら、記録と会話の流れを整える体験用です。'
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
  const normalized = normalizePlan(plan) || PLAN_LABELS.free;
  return PLAN_FEATURES[normalized] || PLAN_FEATURES[PLAN_LABELS.free];
}

function canUseFeature(plan, featureName) {
  const features = getPlanFeatures(plan);
  return Boolean(features?.[featureName]);
}

function buildPlanAnswer(plan) {
  const features = getPlanFeatures(plan);

  return [
    `現在のプランは「${features.label}」です。`,
    features.note,
    `食事写真: ${features.canUseMealPhoto ? '使えます' : '使えません'}`,
    `血液検査画像: ${features.canUseLabImage ? '使えます' : '使えません'}`,
    `日次まとめ: ${features.canUseDailySummary ? '使えます' : '使えません'}`,
    `週間報告: ${features.canUseWeeklyReport ? '使えます' : '使えません'}`,
    `月間報告: ${features.canUseMonthlyReport ? '使えます' : '使えません'}`,
    `ポイント: ${features.canUsePoints ? '使えます' : '使えません'}`
  ].join('\n');
}

module.exports = {
  PLAN_LABELS,
  PLAN_FEATURES,
  normalizePlan,
  getPlanFeatures,
  canUseFeature,
  buildPlanAnswer
};
