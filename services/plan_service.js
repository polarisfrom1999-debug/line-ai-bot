'use strict';

const PLAN_LABELS = {
  free: '無料体験',
  light: 'ライト',
  standard: 'スタンダード',
  premium: 'プレミアム'
};

function normalizePlan(plan) {
  const safe = String(plan || '').trim();
  if (!safe) return null;
  if (/無料/.test(safe)) return PLAN_LABELS.free;
  if (/ライト/.test(safe)) return PLAN_LABELS.light;
  if (/スタンダード/.test(safe)) return PLAN_LABELS.standard;
  if (/プレミアム/.test(safe)) return PLAN_LABELS.premium;
  return safe;
}

module.exports = { PLAN_LABELS, normalizePlan };
