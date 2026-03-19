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

const PLAN_SHORT_DESCRIPTIONS = {
  [PLAN_TYPES.LIGHT]: 'まずは気軽に続けたい方向け',
  [PLAN_TYPES.RECOMMENDED]: '迷ったらこれ。バランス良く続けやすい基本プラン',
  [PLAN_TYPES.PREMIUM]: 'より手厚く伴走したい方向け',
};

const PLAN_DETAIL_LINES = {
  [PLAN_TYPES.LIGHT]: [
    '・まずは無理なく習慣化したい方向け',
    '・自分のペースで続けやすい',
    '・軽めに始めたい時に合わせやすい',
  ],
  [PLAN_TYPES.RECOMMENDED]: [
    '・記録、振り返り、声かけのバランスが良い',
    '・ここから。の伴走感を活かしやすい',
    '・迷った時に選びやすい基本プラン',
  ],
  [PLAN_TYPES.PREMIUM]: [
    '・より細かく変化確認しながら進めやすい',
    '・継続フォローを厚めにしたい時に相性が良い',
    '・本気で生活改善を進めたい方向け',
  ],
};

module.exports = {
  TRIAL_DAYS,
  RENEWAL_DAYS,
  MEMBERSHIP_STATUS,
  PLAN_TYPES,
  PLAN_LABELS,
  PLAN_SHORT_DESCRIPTIONS,
  PLAN_DETAIL_LINES,
};
