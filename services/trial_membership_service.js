'use strict';

const {
  TRIAL_DAYS,
  RENEWAL_DAYS,
  MEMBERSHIP_STATUS,
  PLAN_TYPES,
  PLAN_LABELS,
  PLAN_SHORT_DESCRIPTIONS,
  PLAN_DETAIL_LINES,
} = require('../config/trial_membership_config');

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function nowDate(baseNow = null) {
  const d = baseNow ? new Date(baseNow) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function toIsoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function buildQuickReplies(items = []) {
  const cleaned = items
    .map((item) => safeText(item))
    .filter(Boolean)
    .slice(0, 8);

  if (!cleaned.length) return null;

  return {
    items: cleaned.map((label) => ({
      type: 'action',
      action: {
        type: 'message',
        label: label.slice(0, 20),
        text: label,
      },
    })),
  };
}

function getMembershipStatus(user) {
  const status = safeText(user?.membership_status, MEMBERSHIP_STATUS.NONE);
  if (Object.values(MEMBERSHIP_STATUS).includes(status)) return status;
  return MEMBERSHIP_STATUS.NONE;
}

function getCurrentPlan(user) {
  const plan = safeText(user?.current_plan, '');
  if (Object.values(PLAN_TYPES).includes(plan)) return plan;
  return null;
}

function startTrialPatch(baseNow = null) {
  const now = nowDate(baseNow);
  const trialEndsAt = addDays(now, TRIAL_DAYS);

  return {
    membership_status: MEMBERSHIP_STATUS.TRIAL,
    trial_started_at: now.toISOString(),
    trial_ends_at: trialEndsAt.toISOString(),
    trial_plan_prompted_at: null,
    current_plan: null,
    plan_started_at: null,
    renewal_prompted_at: null,
  };
}

function activatePlanPatch(planType, baseNow = null) {
  const now = nowDate(baseNow);
  const normalizedPlan = Object.values(PLAN_TYPES).includes(planType)
    ? planType
    : PLAN_TYPES.RECOMMENDED;

  return {
    membership_status: MEMBERSHIP_STATUS.ACTIVE,
    current_plan: normalizedPlan,
    plan_started_at: now.toISOString(),
    renewal_prompted_at: null,
  };
}

function pauseMembershipPatch() {
  return {
    membership_status: MEMBERSHIP_STATUS.PAUSED,
  };
}

function cancelMembershipPatch() {
  return {
    membership_status: MEMBERSHIP_STATUS.CANCELLED,
  };
}

function expireTrialPatch() {
  return {
    membership_status: MEMBERSHIP_STATUS.EXPIRED,
  };
}

function markTrialPlanPromptedPatch(baseNow = null) {
  const now = nowDate(baseNow);
  return {
    trial_plan_prompted_at: now.toISOString(),
  };
}

function markRenewalPromptedPatch(baseNow = null) {
  const now = nowDate(baseNow);
  return {
    renewal_prompted_at: now.toISOString(),
  };
}

function isTrialUser(user) {
  return getMembershipStatus(user) === MEMBERSHIP_STATUS.TRIAL;
}

function isActiveMember(user) {
  return getMembershipStatus(user) === MEMBERSHIP_STATUS.ACTIVE;
}

function hasTrialStarted(user) {
  return !!toIsoOrNull(user?.trial_started_at);
}

function hasTrialEnded(user, baseNow = null) {
  const endIso = toIsoOrNull(user?.trial_ends_at);
  if (!endIso) return false;
  return new Date(endIso).getTime() <= nowDate(baseNow).getTime();
}

function shouldPromptTrialPlan(user, baseNow = null) {
  if (!isTrialUser(user)) return false;

  const endIso = toIsoOrNull(user?.trial_ends_at);
  if (!endIso) return false;

  const promptedIso = toIsoOrNull(user?.trial_plan_prompted_at);
  if (promptedIso) return false;

  const now = nowDate(baseNow).getTime();
  const end = new Date(endIso).getTime();

  return now >= end;
}

function shouldPromptRenewal(user, baseNow = null) {
  if (!isActiveMember(user)) return false;

  const planStartedIso = toIsoOrNull(user?.plan_started_at);
  if (!planStartedIso) return false;

  const renewalPromptedIso = toIsoOrNull(user?.renewal_prompted_at);
  if (renewalPromptedIso) return false;

  const dueDate = addDays(new Date(planStartedIso), RENEWAL_DAYS).getTime();
  return nowDate(baseNow).getTime() >= dueDate;
}

function normalizePlanSelection(text) {
  const value = safeText(text).replace(/\s+/g, '');

  if (!value) return null;

  if (
    value.includes('ライト') ||
    value === 'light'
  ) {
    return PLAN_TYPES.LIGHT;
  }

  if (
    value.includes('おすすめ') ||
    value.includes('オススメ') ||
    value === 'recommended'
  ) {
    return PLAN_TYPES.RECOMMENDED;
  }

  if (
    value.includes('しっかり') ||
    value.includes('伴走') ||
    value === 'premium'
  ) {
    return PLAN_TYPES.PREMIUM;
  }

  return null;
}

function isPlanGuideTrigger(text) {
  const value = safeText(text).replace(/\s+/g, '');
  return [
    'プラン',
    'プラン案内',
    'プラン案内を見る',
    '体験終了',
    '継続したい',
    '続けたい',
    '入会したい',
    '契約したい',
    '別プランも見る',
    '内容を確認する',
  ].includes(value);
}

function buildTrialStartedMessage() {
  return {
    text:
      'プロフィール登録ありがとうございます。\n' +
      `今日から${TRIAL_DAYS}日間の無料体験が始まりました。\n\n` +
      'この期間は、食事・体重・運動の記録や、やり取りの雰囲気を気軽に試してみてくださいね。\n' +
      '無理に完璧を目指さなくて大丈夫です。',
    quickReply: buildQuickReplies([
      '今日の記録を始める',
      '使い方を見る',
      'プロフィール確認',
    ]),
  };
}

function buildTrialEndingMessage() {
  return {
    text:
      '1週間の無料体験おつかれさまでした。\n' +
      'ここまでの流れを踏まえて、この先の続け方をご案内できます。\n\n' +
      'ご自身のペースに合う形を選びやすいようにしています。',
    quickReply: buildQuickReplies([
      'プラン案内を見る',
      'まず相談したい',
      'もう少し体験したい',
    ]),
  };
}

function buildPlanGuideMessage() {
  const lines = [
    '続け方は、今後このような形を予定しています。',
    '',
    `【${PLAN_LABELS[PLAN_TYPES.LIGHT]}】`,
    ...PLAN_DETAIL_LINES[PLAN_TYPES.LIGHT],
    '',
    `【${PLAN_LABELS[PLAN_TYPES.RECOMMENDED]}】`,
    ...PLAN_DETAIL_LINES[PLAN_TYPES.RECOMMENDED],
    '',
    `【${PLAN_LABELS[PLAN_TYPES.PREMIUM]}】`,
    ...PLAN_DETAIL_LINES[PLAN_TYPES.PREMIUM],
    '',
    '気になるものをそのまま押してください。',
  ];

  return {
    text: lines.join('\n'),
    quickReply: buildQuickReplies([
      'ライト',
      'おすすめ',
      'しっかり伴走',
      'まず相談したい',
    ]),
  };
}

function buildPlanSelectedMessage(planType) {
  const normalizedPlan = Object.values(PLAN_TYPES).includes(planType)
    ? planType
    : PLAN_TYPES.RECOMMENDED;

  const detailLines = PLAN_DETAIL_LINES[normalizedPlan] || [];

  return {
    text:
      `${PLAN_LABELS[normalizedPlan]}プランを選択ありがとうございます。\n\n` +
      `${detailLines.join('\n')}\n\n` +
      'この内容をベースに、今後の継続案内を進めやすい状態にしました。\n' +
      'あとから変更したくなった時も大丈夫です。',
    quickReply: buildQuickReplies([
      'このプランで進めたい',
      '別プランも見る',
      'まず相談したい',
    ]),
  };
}

function buildRenewalPromptMessage(user) {
  const currentPlan = getCurrentPlan(user);
  const planLabel = currentPlan ? PLAN_LABELS[currentPlan] : '現在の';
  const shortDescription = currentPlan
    ? PLAN_SHORT_DESCRIPTIONS[currentPlan]
    : '今の使い方に合う形';

  return {
    text:
      `${planLabel}プランをご利用いただきありがとうございます。\n` +
      `現在は「${shortDescription}」の形で進んでいます。\n\n` +
      '1か月続けてみて、継続するか、内容を調整するか、別プランにするかをご案内できます。\n' +
      '無理なく続けられる形を一緒に整えていきましょう。',
    quickReply: buildQuickReplies([
      '継続したい',
      'プラン変更したい',
      'まず相談したい',
    ]),
  };
}

module.exports = {
  MEMBERSHIP_STATUS,
  PLAN_TYPES,
  PLAN_LABELS,
  PLAN_SHORT_DESCRIPTIONS,
  PLAN_DETAIL_LINES,
  buildQuickReplies,
  getMembershipStatus,
  getCurrentPlan,
  startTrialPatch,
  activatePlanPatch,
  pauseMembershipPatch,
  cancelMembershipPatch,
  expireTrialPatch,
  markTrialPlanPromptedPatch,
  markRenewalPromptedPatch,
  isTrialUser,
  isActiveMember,
  hasTrialStarted,
  hasTrialEnded,
  shouldPromptTrialPlan,
  shouldPromptRenewal,
  normalizePlanSelection,
  isPlanGuideTrigger,
  buildTrialStartedMessage,
  buildTrialEndingMessage,
  buildPlanGuideMessage,
  buildPlanSelectedMessage,
  buildRenewalPromptMessage,
};
