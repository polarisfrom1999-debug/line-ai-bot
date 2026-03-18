'use strict';

const TRIAL_DAYS = 7;
const RENEWAL_DAYS = 30;

const MEMBERSHIP_STATUS = {
  NONE: 'none',
  TRIAL: 'trial',
  ACTIVE: 'active',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};

const PLAN_TYPES = {
  LIGHT: 'light',
  RECOMMENDED: 'recommended',
  PREMIUM: 'premium',
};

const PLAN_LABELS = {
  [PLAN_TYPES.LIGHT]: 'ライト',
  [PLAN_TYPES.RECOMMENDED]: 'おすすめ',
  [PLAN_TYPES.PREMIUM]: 'しっかり伴走',
};

const PLAN_DESCRIPTIONS = {
  [PLAN_TYPES.LIGHT]: 'まずは気軽に続けたい方向け',
  [PLAN_TYPES.RECOMMENDED]: '迷ったらこれ。いちばんおすすめ',
  [PLAN_TYPES.PREMIUM]: 'より手厚く伴走したい方向け',
};

module.exports = {
  TRIAL_DAYS,
  RENEWAL_DAYS,
  MEMBERSHIP_STATUS,
  PLAN_TYPES,
  PLAN_LABELS,
  PLAN_DESCRIPTIONS,
};
