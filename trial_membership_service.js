'use strict';

const {
  ENGAGEMENT_MILESTONES,
} = require('../config/engagement_config');
const {
  POINT_RULES,
  REWARD_RULES,
} = require('../config/trial_membership_config');

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function buildRewardMessage(milestone, options = {}) {
  const name = safeText(options.display_name || '');
  const prefix = name ? `${name}さん、` : '';

  if (milestone === ENGAGEMENT_MILESTONES.FIRST_CHECKIN) {
    return `${prefix}最初の記録ありがとうございます。ここから少しずつ整えていきましょう。`;
  }

  if (milestone === ENGAGEMENT_MILESTONES.STREAK_3) {
    return `${prefix}3日続きました。もう流れができ始めていますね。`;
  }

  if (milestone === ENGAGEMENT_MILESTONES.STREAK_7) {
    return `${prefix}7日継続おめでとうございます。継続ボーナスとして +${POINT_RULES.streak_7_bonus_points}ポイントの目安です。`;
  }

  if (milestone === ENGAGEMENT_MILESTONES.STREAK_30) {
    return `${prefix}30日継続おめでとうございます。ここまで続けられたのは大きいです。+${POINT_RULES.streak_30_bonus_points}ポイントの目安です。`;
  }

  if (milestone === ENGAGEMENT_MILESTONES.TRIAL_COMPLETE) {
    return `${prefix}無料体験おつかれさまでした。ここまで続けられたこと自体が大きな一歩です。`;
  }

  if (milestone === ENGAGEMENT_MILESTONES.MEMBERSHIP_STARTED) {
    return `${prefix}本プラン開始ありがとうございます。無理なく続けやすい形で整えていきましょう。`;
  }

  if (milestone === ENGAGEMENT_MILESTONES.RESUMED) {
    return `${prefix}再開ありがとうございます。戻ってこられたことがとても大きいです。+${POINT_RULES.resume_bonus_points}ポイントの目安です。`;
  }

  return `${prefix}いい流れですね。ここからまた少しずつ整えていきましょう。`;
}

function buildPremiumRewardGuide() {
  return `プレミアムを${REWARD_RULES.premium_bvlgari_after_months}か月継続すると、特別ごほうび候補があります。`;
}

function buildSpecialRewardGuide() {
  return `スペシャルを${REWARD_RULES.special_bvlgari_after_months}か月継続すると、特別ごほうび候補があります。`;
}

module.exports = {
  buildRewardMessage,
  buildPremiumRewardGuide,
  buildSpecialRewardGuide,
};
