'use strict';

const {
  MEMBERSHIP_STATUS,
  PLAN_TYPES,
  PLAN_LABELS,
} = require('../config/trial_membership_config');

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function nowIso(baseNow = null) {
  const d = baseNow ? new Date(baseNow) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function normalizeLoose(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function normalizePlanType(planType, fallback = PLAN_TYPES.BASIC) {
  const value = safeText(planType);
  if (Object.values(PLAN_TYPES).includes(value)) return value;
  return fallback;
}

function isMembershipConfirmIntent(text) {
  const t = normalizeLoose(text);
  return [
    '確定',
    'この内容で確定',
    'この内容で進める',
    'これで確定',
    'お願いします',
  ].some((x) => t === normalizeLoose(x));
}

function isMembershipCancelIntent(text) {
  const t = normalizeLoose(text);
  return [
    'やめる',
    'キャンセル',
    '戻る',
    '今回はやめる',
  ].some((x) => t === normalizeLoose(x));
}

function buildActivatePlanPatch(planType, baseNow = null) {
  const now = nowIso(baseNow);
  return {
    membership_status: MEMBERSHIP_STATUS.ACTIVE,
    current_plan: normalizePlanType(planType),
    plan_started_at: now,
    renewal_prompted_at: null,
  };
}

function buildPauseMembershipPatch(baseNow = null, reason = '') {
  return {
    membership_status: MEMBERSHIP_STATUS.PAUSED,
    paused_reason: safeText(reason),
    membership_status_updated_at: nowIso(baseNow),
    renewal_prompted_at: nowIso(baseNow),
  };
}

function buildCancelMembershipPatch(baseNow = null, reason = '') {
  return {
    membership_status: MEMBERSHIP_STATUS.CANCELLED,
    cancel_reason: safeText(reason),
    membership_status_updated_at: nowIso(baseNow),
    renewal_prompted_at: nowIso(baseNow),
  };
}

function buildResumeMembershipPatch(currentPlan, baseNow = null) {
  return {
    membership_status: MEMBERSHIP_STATUS.ACTIVE,
    current_plan: normalizePlanType(currentPlan),
    renewal_prompted_at: null,
    membership_status_updated_at: nowIso(baseNow),
    plan_started_at: nowIso(baseNow),
  };
}

function buildMembershipConfirmMessage(actionType, planLabel = '') {
  if (actionType === 'pause') {
    return [
      'いったん休止の方向で進めます。',
      'また再開したくなった時もすぐ戻せる形にしておきます。',
    ].join('\n');
  }

  if (actionType === 'cancel') {
    return [
      '終了の方向で進めます。',
      '必要になった時は、またここから再開できるようにしておきます。',
    ].join('\n');
  }

  if (actionType === 'resume') {
    return [
      `${planLabel || '現在のプラン'}で再開の方向に整えます。`,
      '今のペースに合う形で続けやすくしていきましょう。',
    ].join('\n');
  }

  return [
    `${planLabel || 'このプラン'}で進める方向に整えます。`,
    'あとから変更したくなった時も大丈夫です。',
  ].join('\n');
}

function buildMembershipCancelMessage() {
  return '今回は変更を確定せず、そのままにしておきます。必要な時にまた選べます。';
}

function getPlanLabel(planType) {
  const normalized = normalizePlanType(planType);
  return PLAN_LABELS[normalized] || PLAN_LABELS[PLAN_TYPES.BASIC];
}

module.exports = {
  isMembershipConfirmIntent,
  isMembershipCancelIntent,
  buildActivatePlanPatch,
  buildPauseMembershipPatch,
  buildCancelMembershipPatch,
  buildResumeMembershipPatch,
  buildMembershipConfirmMessage,
  buildMembershipCancelMessage,
  getPlanLabel,
};
