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
  BASIC: 'basic',
  PREMIUM: 'premium',
  SPECIAL: 'special',
};

const ENTRY_TRIAL_LABEL = '1週間ライト無料体験';

const PLAN_LABELS = {
  [PLAN_TYPES.LIGHT]: 'ライト',
  [PLAN_TYPES.BASIC]: 'ベーシック',
  [PLAN_TYPES.PREMIUM]: 'プレミアム',
  [PLAN_TYPES.SPECIAL]: '人数限定！絶対痩せたいスペシャル',
};

const PLAN_PRICES = {
  [PLAN_TYPES.LIGHT]: 2980,
  [PLAN_TYPES.BASIC]: 5980,
  [PLAN_TYPES.PREMIUM]: 9800,
  [PLAN_TYPES.SPECIAL]: 29800,
};

const PLAN_SHORT_DESCRIPTIONS = {
  [PLAN_TYPES.LIGHT]: 'まずは無理なく続けたい方向け',
  [PLAN_TYPES.BASIC]: '迷ったらこれ。AI伴走と週間報告の基本プラン',
  [PLAN_TYPES.PREMIUM]: '牛込手書き週間報告と月間報告まで含む手厚い伴走',
  [PLAN_TYPES.SPECIAL]: '本気で変わりたい方向けの人数限定・特別伴走枠',
};

const PLAN_FEATURES = {
  [PLAN_TYPES.LIGHT]: [
    'AI毎日返信のみ',
  ],
  [PLAN_TYPES.BASIC]: [
    'AI毎日返信',
    '週間報告',
  ],
  [PLAN_TYPES.PREMIUM]: [
    'AI毎日返信',
    '牛込手書き週間報告',
    '月間報告',
  ],
  [PLAN_TYPES.SPECIAL]: [
    'AI毎日返信',
    '牛込手書き毎日',
    '牛込手書き週間報告',
    '月間報告',
    '整骨院優先予約枠あり',
  ],
};

const SPECIAL_PLAN_NOTE =
  '通常の上位プランではなく、本気で結果を出したい方向けの特別伴走枠です。';

const POINT_RULES = {
  daily_checkin_points: 1,
  streak_7_bonus_points: 3,
  streak_30_bonus_points: 10,
  trial_complete_points: 3,
  resume_bonus_points: 5,
  basic_monthly_bonus_points: 3,
  premium_monthly_bonus_points: 5,
  special_monthly_bonus_points: 10,
  exchange_points: 100,
  exchange_reward_yen: 500,
  exchange_reward_label: '整骨院サービス券',
};

const REWARD_RULES = {
  premium_bvlgari_after_months: 3,
  special_bvlgari_after_months: 2,
  premium_bvlgari_label: 'ブルガリのチョコレート1個',
  special_bvlgari_label: 'ブルガリのチョコレート1個',
};

const REFERRAL_RULES = {
  referrer_discount_yen: 500,
  referrer_reward_label: '翌月料金割引',
  referee_benefit_label: '無料体験延長候補',
};

const PAUSE_REASON_OPTIONS = [
  '忙しい',
  '費用面',
  '体調面',
  'モチベ低下',
  '効果を感じにくい',
  'その他',
  '今は答えない',
];

const CANCEL_REASON_OPTIONS = [
  '忙しい',
  '費用面',
  '体調面',
  '効果を感じにくい',
  '自分で続けたい',
  'その他',
  '今は答えない',
];

module.exports = {
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
  PAUSE_REASON_OPTIONS,
  CANCEL_REASON_OPTIONS,
};
