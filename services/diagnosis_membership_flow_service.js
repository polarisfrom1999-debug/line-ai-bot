'use strict';

/**
 * services/diagnosis_membership_flow_service.js
 *
 * 目的:
 * - trial / paid / inactive / pending_payment の状態管理を整理する
 * - index.js 側の分岐を見やすくする
 * - 決済完了後の反映を最短で扱いやすくする
 */

const {
  getPlanDefinition,
  buildCheckoutMessage,
  detectPlanKeyFromText,
} = require('./diagnosis_plan_links');

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeMembershipStatus(value) {
  const raw = safeText(value).toLowerCase();

  if (!raw) return 'inactive';
  if (['trial', 'trialing', 'free_trial'].includes(raw)) return 'trial';
  if (['paid', 'active', 'member'].includes(raw)) return 'paid';
  if (['pending_payment', 'awaiting_payment'].includes(raw)) return 'pending_payment';
  if (['cancelled', 'canceled', 'inactive', 'none'].includes(raw)) return 'inactive';

  return raw;
}

function normalizePlanKey(value) {
  return safeText(value).toLowerCase();
}

function buildStartTrialStatePatch(opts = {}) {
  const recommendedType = safeText(opts.recommendedType, 'そっと寄り添う');
  const startDate = safeText(opts.startDate);
  const endDate = safeText(opts.endDate);

  return {
    membership_status: 'trial',
    trial_status: 'active',
    trial_start_date: startDate,
    trial_end_date: endDate,
    recommended_ai_type: recommendedType,
    selected_plan: 'light_trial',
    pending_payment_plan: null,
    pending_payment_link: null,
  };
}

function buildPlanSelectionStatePatch(planKey) {
  const def = getPlanDefinition(planKey);
  if (!def) {
    return {
      membership_status: 'trial',
      pending_payment_plan: null,
      pending_payment_link: null,
    };
  }

  return {
    membership_status: 'pending_payment',
    pending_payment_plan: def.key,
    pending_payment_link: process.env[def.env_key] || '',
  };
}

function buildPaymentCompletedStatePatch(planKey) {
  const def = getPlanDefinition(planKey);
  if (!def) {
    return {
      membership_status: 'paid',
      selected_plan: 'light',
      trial_status: 'ended',
      pending_payment_plan: null,
      pending_payment_link: null,
    };
  }

  return {
    membership_status: 'paid',
    selected_plan: def.key,
    trial_status: 'ended',
    pending_payment_plan: null,
    pending_payment_link: null,
  };
}

function buildCurrentPlanMessage(user = {}) {
  const membershipStatus = normalizeMembershipStatus(user.membership_status);
  const selectedPlan = normalizePlanKey(user.selected_plan);

  if (membershipStatus === 'trial') {
    return '現在は7日無料ライト体験中です。';
  }

  if (membershipStatus === 'pending_payment') {
    const pendingPlan = normalizePlanKey(user.pending_payment_plan);
    const def = getPlanDefinition(pendingPlan);
    if (!def) return '現在はお申し込み手続き待ちです。';
    return `現在は「${def.label}」のお申し込み手続き待ちです。`;
  }

  if (membershipStatus === 'paid') {
    const def = getPlanDefinition(selectedPlan);
    if (!def) return '現在は本プランご利用中です。';
    return `現在のご利用プランは「${def.label}」です。`;
  }

  return '現在は未入会です。無料診断または無料体験から始められます。';
}

function buildPlanSelectionReply(text, opts = {}) {
  const planKey = detectPlanKeyFromText(text);
  if (!planKey) return null;

  return {
    plan_key: planKey,
    message: buildCheckoutMessage(planKey, opts),
    state_patch: buildPlanSelectionStatePatch(planKey),
  };
}

function isTrialUser(user = {}) {
  return normalizeMembershipStatus(user.membership_status) === 'trial';
}

function isPaidUser(user = {}) {
  return normalizeMembershipStatus(user.membership_status) === 'paid';
}

function isPendingPaymentUser(user = {}) {
  return normalizeMembershipStatus(user.membership_status) === 'pending_payment';
}

function canAccessPaidFeatures(user = {}) {
  return isPaidUser(user);
}

function shouldShowTrialUpgradePrompt(user = {}) {
  return isTrialUser(user) || isPendingPaymentUser(user);
}

module.exports = {
  normalizeMembershipStatus,
  normalizePlanKey,
  buildStartTrialStatePatch,
  buildPlanSelectionStatePatch,
  buildPaymentCompletedStatePatch,
  buildCurrentPlanMessage,
  buildPlanSelectionReply,
  isTrialUser,
  isPaidUser,
  isPendingPaymentUser,
  canAccessPaidFeatures,
  shouldShowTrialUpgradePrompt,
};
