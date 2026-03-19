'use strict';

/**
 * services/membership_flow_service.js
 *
 * 役割:
 * - 無料体験終了時の振り返り文
 * - 月末継続案内
 * - 休止中ユーザーの再開導線
 * - プラン比較の見せ分け
 * - スペシャルを「特別枠」として扱う
 */

const {
  PLAN_TYPES,
  PLAN_LABELS,
  PLAN_PRICES,
  PLAN_FEATURES,
  PLAN_SHORT_DESCRIPTIONS,
  SPECIAL_PLAN_NOTE,
  ENTRY_TRIAL_LABEL,
  POINT_RULES,
  REWARD_RULES,
  REFERRAL_RULES,
} = require('../config/trial_membership_config');

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
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

function formatPlanPrice(planType) {
  const price = PLAN_PRICES?.[planType];
  if (price == null) return '';
  return `${Number(price).toLocaleString('ja-JP')}円`;
}

function buildPlanCardLines(planType) {
  const label = PLAN_LABELS?.[planType] || planType;
  const price = formatPlanPrice(planType);
  const shortDescription = PLAN_SHORT_DESCRIPTIONS?.[planType] || '';
  const features = Array.isArray(PLAN_FEATURES?.[planType]) ? PLAN_FEATURES[planType] : [];

  return [
    `【${label}】${price ? ` 月額 ${price}` : ''}`,
    shortDescription || null,
    ...features.map((x) => `・${x}`),
  ].filter(Boolean);
}

function buildTrialReviewMessage(user = {}, options = {}) {
  const displayName = safeText(options.display_name || user.display_name || '');
  const heading = displayName
    ? `${displayName}さん、1週間の無料体験おつかれさまでした。`
    : '1週間の無料体験おつかれさまでした。';

  const lines = [
    heading,
    '',
    `ここまでの体験では、まず ${ENTRY_TRIAL_LABEL} の雰囲気を試していただく形で進んできました。`,
    '続け方は、ご自身のペースやサポートの深さに合わせて選べます。',
    '',
    ...buildPlanCardLines(PLAN_TYPES.LIGHT),
    '',
    ...buildPlanCardLines(PLAN_TYPES.BASIC),
    '',
    ...buildPlanCardLines(PLAN_TYPES.PREMIUM),
    '',
    `【${PLAN_LABELS[PLAN_TYPES.SPECIAL]}】 月額 ${formatPlanPrice(PLAN_TYPES.SPECIAL)}`,
    SPECIAL_PLAN_NOTE,
    ...((PLAN_FEATURES?.[PLAN_TYPES.SPECIAL] || []).map((x) => `・${x}`)),
    '',
    `毎日の記録や継続でポイントもたまり、${POINT_RULES.exchange_points}ポイントで${POINT_RULES.exchange_reward_yen}円分の整骨院サービス券にできます。`,
    `ご紹介特典として、紹介した方は翌月${REFERRAL_RULES.referrer_discount_yen}円引きの対象にしやすい設計です。`,
    '',
    '気になる続け方をそのまま押してください。',
  ];

  return {
    text: lines.join('\n'),
    quickReply: buildQuickReplies([
      'ライト',
      'ベーシック',
      'プレミアム',
      'スペシャル',
      'まず相談したい',
      '少し休みたい',
    ]),
  };
}

function buildMonthlyRenewalMessage(user = {}, options = {}) {
  const currentPlan = safeText(options.current_plan || user.current_plan || '');
  const currentLabel = PLAN_LABELS?.[currentPlan] || '現在のプラン';
  const currentPrice = currentPlan ? formatPlanPrice(currentPlan) : '';
  const heading = currentPlan
    ? `${currentLabel}${currentPrice ? `（月額 ${currentPrice}）` : ''}をご利用ありがとうございます。`
    : 'ここまでご利用ありがとうございます。';

  const lines = [
    heading,
    '',
    '今の使い方に合わせて、このまま継続するか、少し軽くするか、手厚くするかを選べます。',
    '無理なく続けられる形を一緒に整えていきましょう。',
    '',
    `ポイントは、1日1ポイント・7日連続で+${POINT_RULES.streak_7_bonus_points}・30日継続で+${POINT_RULES.streak_30_bonus_points}です。`,
    `プレミアムを${REWARD_RULES.premium_bvlgari_after_months}か月継続、スペシャルを${REWARD_RULES.special_bvlgari_after_months}か月継続で、特別ごほうび候補も用意しています。`,
  ];

  return {
    text: lines.join('\n'),
    quickReply: buildQuickReplies([
      '継続したい',
      'プラン変更したい',
      '少し休みたい',
      'まず相談したい',
    ]),
  };
}

function buildPlanGuideMessageV2() {
  const lines = [
    'ここから。の続け方はこちらです。',
    '',
    `入口: ${ENTRY_TRIAL_LABEL}`,
    '',
    ...buildPlanCardLines(PLAN_TYPES.LIGHT),
    '',
    ...buildPlanCardLines(PLAN_TYPES.BASIC),
    '',
    ...buildPlanCardLines(PLAN_TYPES.PREMIUM),
    '',
    `【${PLAN_LABELS[PLAN_TYPES.SPECIAL]}】 月額 ${formatPlanPrice(PLAN_TYPES.SPECIAL)}`,
    SPECIAL_PLAN_NOTE,
    ...((PLAN_FEATURES?.[PLAN_TYPES.SPECIAL] || []).map((x) => `・${x}`)),
    '',
    `ポイント特典: ${POINT_RULES.exchange_points}ポイントで${POINT_RULES.exchange_reward_yen}円分の整骨院サービス券`,
    `継続ごほうび: プレミアム${REWARD_RULES.premium_bvlgari_after_months}か月 / スペシャル${REWARD_RULES.special_bvlgari_after_months}か月`,
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

function buildPauseReasonPrompt() {
  return {
    text: [
      '少し休む方向で大丈夫です。',
      'よければ理由を教えてください。無理に書かなくても大丈夫です。',
    ].join('\n'),
    quickReply: buildQuickReplies([
      '忙しい',
      '費用面',
      '体調面',
      'モチベ低下',
      '効果を感じにくい',
      'その他',
      '今は答えない',
    ]),
  };
}

function buildCancelReasonPrompt() {
  return {
    text: [
      '終了の方向で大丈夫です。',
      'よければ理由を教えてください。今後の改善の参考にしたいです。',
      '無理に書かなくても大丈夫です。',
    ].join('\n'),
    quickReply: buildQuickReplies([
      '忙しい',
      '費用面',
      '体調面',
      '効果を感じにくい',
      '自分で続けたい',
      'その他',
      '今は答えない',
    ]),
  };
}

function buildResumeGuideMessage(user = {}) {
  const currentPlan = safeText(user.current_plan || '');
  const currentLabel = PLAN_LABELS?.[currentPlan] || '今までのプラン';

  return {
    text: [
      'また再開したくなった時は、ここからすぐ戻れます。',
      `${currentLabel}で再開することも、別プランに変えることもできます。`,
      `再開時には +${POINT_RULES.resume_bonus_points}ポイントの対象にしやすい設計です。`,
      '',
      'ご希望に近いものを押してください。',
    ].join('\n'),
    quickReply: buildQuickReplies([
      'このまま再開したい',
      'プラン変更して再開したい',
      'まず相談したい',
      '今はまだ再開しない',
    ]),
  };
}

module.exports = {
  buildTrialReviewMessage,
  buildMonthlyRenewalMessage,
  buildPlanGuideMessageV2,
  buildPauseReasonPrompt,
  buildCancelReasonPrompt,
  buildResumeGuideMessage,
};
