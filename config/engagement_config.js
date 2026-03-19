'use strict';

/**
 * config/engagement_config.js
 *
 * 役割:
 * - 継続ポイント
 * - お祝いタイミング
 * - やさしいリマインド文言
 * - 年配の方向け入力補助文言
 */

const ENGAGEMENT_MILESTONES = {
  FIRST_CHECKIN: 'first_checkin',
  STREAK_3: 'streak_3',
  STREAK_7: 'streak_7',
  STREAK_30: 'streak_30',
  TRIAL_COMPLETE: 'trial_complete',
  MEMBERSHIP_STARTED: 'membership_started',
  RESUMED: 'resumed',
};

const ENGAGEMENT_LABELS = {
  [ENGAGEMENT_MILESTONES.FIRST_CHECKIN]: '初回記録',
  [ENGAGEMENT_MILESTONES.STREAK_3]: '3日継続',
  [ENGAGEMENT_MILESTONES.STREAK_7]: '7日継続',
  [ENGAGEMENT_MILESTONES.STREAK_30]: '30日継続',
  [ENGAGEMENT_MILESTONES.TRIAL_COMPLETE]: '無料体験完了',
  [ENGAGEMENT_MILESTONES.MEMBERSHIP_STARTED]: '本プラン開始',
  [ENGAGEMENT_MILESTONES.RESUMED]: '再開',
};

const GENTLE_REMINDER_TEMPLATES = {
  morning: [
    'おはようございます。体重だけでも大丈夫ですよ。',
    'おはようございます。短くて大丈夫です。数字だけでも送れます。',
  ],
  afternoon: [
    'お昼の記録は、あとからまとめてでも大丈夫です。',
    '昼食は1品だけでも大丈夫ですよ。',
  ],
  evening: [
    '今日は食事か運動のどちらか一つだけでも大丈夫です。',
    '昨日の分でも記録できますので、思い出せる範囲で大丈夫です。',
  ],
  fallback: [
    'うまく送れなくても大丈夫です。短くて大丈夫ですよ。',
    '間違ってもやり直せるので、思い出せる範囲で大丈夫です。',
  ],
};

const INPUT_HELP_TEMPLATES = {
  short_examples: [
    '体重 57.2',
    '朝 パンとコーヒー',
    '20分歩いた',
    '昨日 夜 ラーメン',
  ],
  reassurance_lines: [
    'うまく書けなくても大丈夫です。',
    '数字だけ、1品だけ、短い言葉だけでも大丈夫です。',
    '間違っていたら「やり直し」で大丈夫です。',
  ],
};

module.exports = {
  ENGAGEMENT_MILESTONES,
  ENGAGEMENT_LABELS,
  GENTLE_REMINDER_TEMPLATES,
  INPUT_HELP_TEMPLATES,
};
