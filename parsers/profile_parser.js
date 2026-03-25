'use strict';

const { round0, round1 } = require('../utils/formatters');

function parseActivityLevel(text) {
  const t = String(text || '');
  if (/活動量\s*[:：]?\s*(高い|多い|激しい)/.test(t) || /かなり動く|激しい/.test(t)) return 'high';
  if (/活動量\s*[:：]?\s*(やや高い|多め)/.test(t) || /よく動く/.test(t)) return 'moderate_high';
  if (/活動量\s*[:：]?\s*(ふつう|普通)/.test(t) || /たまに動く|週1|週2/.test(t)) return 'moderate';
  if (/活動量\s*[:：]?\s*(低い|少ない)/.test(t) || /あまり動かない|ほぼ運動なし/.test(t)) return 'low';
  return null;
}

function pickValue(text, labels) {
  for (const label of labels) {
    const m = String(text || '').match(new RegExp(`${label}\\s*[:：]?\\s*(\\d{1,3}(?:\\.\\d+)?)`, 'i'));
    if (m) return Number(m[1]);
  }
  return null;
}

function parseProfile(text) {
  const base = String(text || '').trim();
  const result = {};

  if (!base) return result;

  if (/(男性|男)/.test(base)) result.sex = 'male';
  if (/(女性|女)/.test(base)) result.sex = 'female';

  const age = pickValue(base, ['年齢']);
  if (age != null) result.age = round0(age);

  const height = pickValue(base, ['身長']);
  if (height != null) result.height_cm = round1(height);

  const weight = pickValue(base, ['体重']);
  if (weight != null) result.weight_kg = round1(weight);

  const target = pickValue(base, ['目標体重', '目標']);
  if (target != null) result.target_weight_kg = round1(target);

  const activity = parseActivityLevel(base);
  if (activity) result.activity_level = activity;

  return result;
}

function getActivityMultiplier(activityLevel) {
  if (activityLevel === 'high') return 1.75;
  if (activityLevel === 'moderate_high') return 1.55;
  if (activityLevel === 'moderate') return 1.375;
  return 1.2;
}

function calculateBMR(user) {
  if (!user?.sex || !user?.age || !user?.height_cm || !user?.weight_kg) return null;
  const w = Number(user.weight_kg);
  const h = Number(user.height_cm);
  const a = Number(user.age);
  if (user.sex === 'male') return round1(10 * w + 6.25 * h - 5 * a + 5);
  return round1(10 * w + 6.25 * h - 5 * a - 161);
}

function calculateTDEE(user) {
  const bmr = calculateBMR(user);
  if (!bmr) return null;
  return round1(bmr * getActivityMultiplier(user.activity_level));
}

function profileGuideMessage() {
  return [
    '変えたい項目だけ、そのまま送って大丈夫です。',
    '例: 体重 62 / 身長 160 / 年齢 55 / 目標 58 / 活動量 ふつう',
    '終わったら「完了」で閉じます。',
  ].join('\n');
}

module.exports = {
  parseProfile,
  parseActivityLevel,
  getActivityMultiplier,
  calculateBMR,
  calculateTDEE,
  profileGuideMessage,
};
