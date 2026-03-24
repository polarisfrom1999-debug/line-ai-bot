'use strict';

const {
  TRIAL_DAYS,
  RENEWAL_DAYS,
  MEMBERSHIP_STATUS,
  PLAN_TYPES,
  ENTRY_TRIAL_LABEL,
  PLAN_LABELS,
  PLAN_PRICES,
  PLAN_SHORT_DESCRIPTIONS,
  PLAN_FEATURES,
  SPECIAL_PLAN_NOTE,
  POINT_RULES,
  REWARD_RULES,
  REFERRAL_RULES,
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

function formatDateJa(value) {
  const iso = toIsoOrNull(value);
  if (!iso) return '未設定';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatPrice(planType) {
  const price = PLAN_PRICES?.[planType];
  if (price == null) return '';
  return `${Number(price).toLocaleString('ja-JP')}円`;
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
    : PLAN_TYPES.BASIC;

  return {
    membership_status: MEMBERSHIP_STATUS.ACTIVE,
    current_plan: normalizedPlan,
    plan_started_at: now.toISOString(),
    renewal_prompted_at: null,
  };
}

function pauseMembershipPatch(baseNow = null) {
  return {
    membership_status: MEMBERSHIP_STATUS.PAUSED,
    renewal_prompted_at: nowDate(baseNow).toISOString(),
  };
}

function cancelMembershipPatch(baseNow = null) {
  return {
    membership_status: MEMBERSHIP_STATUS.CANCELLED,
    renewal_prompted_at: nowDate(baseNow).toISOString(),
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

  if (value.includes('ライト') || value === 'light') {
    return PLAN_TYPES.LIGHT;
  }

  if (value.includes('ベーシック') || value === 'basic') {
    return PLAN_TYPES.BASIC;
  }

  if (value.includes('プレミアム') || value === 'premium') {
    return PLAN_TYPES.PREMIUM;
  }

  if (
    value.includes('スペシャル') ||
    value.includes('絶対痩せたい') ||
    value === 'special'
  ) {
    return PLAN_TYPES.SPECIAL;
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
    'プランをもう一度見る',
    'プラン再表示',
  ].includes(value);
}

function isTrialStatusIntent(text) {
  const value = safeText(text).replace(/\s+/g, '');
  return [
    '体験状況',
    '体験状況確認',
    '無料体験',
    '無料体験確認',
    '今の体験状況',
  ].includes(value);
}

function isCurrentPlanIntent(text) {
  const value = safeText(text).replace(/\s+/g, '');
  return [
    '現在のプラン',
    'プラン確認',
    '今のプラン',
    '契約状況',
    '現在の契約',
  ].includes(value);
}

function buildPlanLines(planType) {
  const label = PLAN_LABELS[planType];
  const price = formatPrice(planType);
  const shortDescription = PLAN_SHORT_DESCRIPTIONS[planType] || '';
  const features = PLAN_FEATURES[planType] || [];

  return [
    `【${label}】 月額 ${price}`,
    shortDescription || null,
    ...features.map((x) => `・${x}`),
  ].filter(Boolean);
}

function buildTrialStartedMessage() {
  return {
    text:
      'プロフィール登録ありがとうございます。\n' +
      `今日から${TRIAL_DAYS}日間の無料体験が始まりました。\n` +
      `まずは ${ENTRY_TRIAL_LABEL} として、やり取りの雰囲気や記録のしやすさを気軽に試してみてください。\n\n` +
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
      'ここからは、ご自身のペースやサポートの深さに合わせて続け方を選べます。\n\n' +
      `毎日の記録や継続でポイントもたまり、${POINT_RULES.exchange_points}ポイントで${POINT_RULES.exchange_reward_yen}円分の${POINT_RULES.exchange_reward_label}にできます。`,
    quickReply: buildQuickReplies([
      'プラン案内を見る',
      'まず相談したい',
      '少し休みたい',
    ]),
  };
}

function buildPlanGuideMessage() {
  const lines = [
    'ここから。の続け方はこちらです。',
    '',
    `入口: ${ENTRY_TRIAL_LABEL}`,
    '',
    ...buildPlanLines(PLAN_TYPES.LIGHT),
    '',
    ...buildPlanLines(PLAN_TYPES.BASIC),
    '',
    ...buildPlanLines(PLAN_TYPES.PREMIUM),
    '',
    `【${PLAN_LABELS[PLAN_TYPES.SPECIAL]}】 月額 ${formatPrice(PLAN_TYPES.SPECIAL)}`,
    SPECIAL_PLAN_NOTE,
    ...((PLAN_FEATURES[PLAN_TYPES.SPECIAL] || []).map((x) => `・${x}`)),
    '',
    `ポイント特典: ${POINT_RULES.exchange_points}ポイントで${POINT_RULES.exchange_reward_yen}円分の${POINT_RULES.exchange_reward_label}`,
    `継続ごほうび: プレミアム${REWARD_RULES.premium_bvlgari_after_months}か月 / スペシャル${REWARD_RULES.special_bvlgari_after_months}か月`,
    `紹介特典: ご紹介で翌月${REFERRAL_RULES.referrer_discount_yen}円引き候補`,
    '',
    '気になるものをそのまま押してください。',
  ];

  return {
    text: lines.join('\n'),
    quickReply: buildQuickReplies([
      'ライト',
      'ベーシック',
      'プレミアム',
      'スペシャル',
      'まず相談したい',
    ]),
  };
}

function buildPlanSelectedMessage(planType) {
  const normalizedPlan = Object.values(PLAN_TYPES).includes(planType)
    ? planType
    : PLAN_TYPES.BASIC;

  const label = PLAN_LABELS[normalizedPlan];
  const price = formatPrice(normalizedPlan);
  const featureLines = PLAN_FEATURES[normalizedPlan] || [];

  const lines = [
    `${label}プランを選択ありがとうございます。`,
    `月額 ${price}`,
    '',
    ...featureLines.map((x) => `・${x}`),
    '',
    normalizedPlan === PLAN_TYPES.SPECIAL
      ? 'このプランは通常の上位ではなく、本気で変わりたい方向けの人数限定・特別伴走枠です。'
      : '今の続け方の候補として整えました。あとから変更したくなった時も大丈夫です。',
  ];

  return {
    text: lines.join('\n'),
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
      'このまま継続するか、少し軽くするか、もう少し手厚くするかを選べます。\n' +
      '無理なく続けられる形を一緒に整えていきましょう。',
    quickReply: buildQuickReplies([
      '継続したい',
      'プラン変更したい',
      '少し休みたい',
      'まず相談したい',
    ]),
  };
}

function buildTrialStatusMessage(user) {
  const status = getMembershipStatus(user);
  const lines = ['現在の体験状況です。'];

  if (!user?.trial_started_at) {
    lines.push('無料体験はまだ開始していません。');
  } else {
    lines.push(`開始日: ${formatDateJa(user.trial_started_at)}`);
    lines.push(`終了予定: ${formatDateJa(user.trial_ends_at)}`);
    lines.push(`状態: ${status === MEMBERSHIP_STATUS.TRIAL ? '無料体験中' : '体験終了または切替済み'}`);
  }

  if (user?.trial_plan_prompted_at) {
    lines.push(`プラン案内表示: ${formatDateJa(user.trial_plan_prompted_at)}`);
  }

  return {
    text: lines.join('\n'),
    quickReply: buildQuickReplies([
      '現在のプラン',
      'プラン案内を見る',
      'プロフィール確認',
    ]),
  };
}

function buildCurrentPlanStatusMessage(user) {
  const status = getMembershipStatus(user);
  const currentPlan = getCurrentPlan(user);

  const lines = ['現在のプラン状況です。'];

  if (status !== MEMBERSHIP_STATUS.ACTIVE || !currentPlan) {
    lines.push('本契約プランはまだ設定されていません。');
  } else {
    lines.push(`現在のプラン: ${PLAN_LABELS[currentPlan]}`);
    lines.push(`月額: ${formatPrice(currentPlan)}`);
    lines.push(`開始日: ${formatDateJa(user.plan_started_at)}`);
    lines.push(`案内: ${PLAN_SHORT_DESCRIPTIONS[currentPlan]}`);
  }

  if (user?.renewal_prompted_at) {
    lines.push(`継続案内表示: ${formatDateJa(user.renewal_prompted_at)}`);
  }

  return {
    text: lines.join('\n'),
    quickReply: buildQuickReplies([
      'プラン案内を見る',
      '体験状況確認',
      'プラン変更したい',
    ]),
  };
}

module.exports = {
  MEMBERSHIP_STATUS,
  PLAN_TYPES,
  PLAN_LABELS,
  PLAN_PRICES,
  PLAN_SHORT_DESCRIPTIONS,
  PLAN_FEATURES,
  SPECIAL_PLAN_NOTE,
  ENTRY_TRIAL_LABEL,
  POINT_RULES,
  REWARD_RULES,
  REFERRAL_RULES,
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
  isTrialStatusIntent,
  isCurrentPlanIntent,
  buildTrialStartedMessage,
  buildTrialEndingMessage,
  buildPlanGuideMessage,
  buildPlanSelectedMessage,
  buildRenewalPromptMessage,
  buildTrialStatusMessage,
  buildCurrentPlanStatusMessage,
};
