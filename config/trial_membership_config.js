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
  [PLAN_TYPES.RECOMMENDED]: '迷ったらこれ。いちばんおすすめ',
  [PLAN_TYPES.PREMIUM]: 'より手厚く伴走したい方向け',
};

const PLAN_DETAIL_LINES = {
  [PLAN_TYPES.LIGHT]: [
    '・まずは気軽に続けたい方向け',
    '・自分のペースで記録を続けやすい形',
    '・はじめての継続利用にも合わせやすい',
  ],
  [PLAN_TYPES.RECOMMENDED]: [
    '・迷ったらこれの基本プラン',
    '・記録、振り返り、声かけのバランスが取りやすい',
    '・ここから。をしっかり活かしたい方におすすめ',
  ],
  [PLAN_TYPES.PREMIUM]: [
    '・より手厚く伴走したい方向け',
    '・変化確認や継続フォローを厚めにしたい時向け',
    '・本気で生活改善を進めたい方に相性が良い',
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
