const { findNumber, findOne } = require('../utils/text_helpers');
const { round0, round1 } = require('../utils/formatters');

function parseProfile(text) {
  const result = {};
  const base = String(text || '');

  const sex = findOne(base, [/(男性|男)/, /(女性|女)/]);
  if (sex) result.sex = sex.includes('男') ? 'male' : 'female';

  const age = findNumber(base, /年齢\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (age != null) result.age = round0(age);

  const height = findNumber(base, /身長\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (height != null) result.height_cm = round1(height);

  const weight = findNumber(base, /体重\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (weight != null) result.weight_kg = round1(weight);

  const target = findNumber(base, /目標体重\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (target != null) result.target_weight_kg = round1(target);

  const activityLevel = parseActivityLevel(base);
  if (activityLevel) result.activity_level = activityLevel;

  return result;
}

function parseActivityLevel(text) {
  const t = String(text || '');

  if (
    t.includes('活動量 高い') ||
    t.includes('日常活動量 高い') ||
    t.includes('仕事でよく動く') ||
    t.includes('かなり動く')
  ) return 'high';

  if (
    t.includes('活動量 やや高い') ||
    t.includes('日常活動量 やや高い') ||
    t.includes('週3回以上') ||
    t.includes('よく動く')
  ) return 'moderate_high';

  if (
    t.includes('活動量 ふつう') ||
    t.includes('日常活動量 ふつう') ||
    t.includes('たまに動く') ||
    t.includes('週1〜2回')
  ) return 'moderate';

  if (
    t.includes('活動量 低い') ||
    t.includes('日常活動量 低い') ||
    t.includes('ほぼ運動なし') ||
    t.includes('あまり動かない')
  ) return 'low';

  return null;
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

  if (user.sex === 'male') {
    return round1(10 * w + 6.25 * h - 5 * a + 5);
  }

  return round1(10 * w + 6.25 * h - 5 * a - 161);
}

function calculateTDEE(user) {
  const bmr = calculateBMR(user);
  if (!bmr) return null;

  const multiplier = getActivityMultiplier(user.activity_level);
  return round1(bmr * multiplier);
}

function profileGuideMessage() {
  return [
    '例: プロフィール 性別 女性 年齢 55 身長 160 体重 63 目標体重 58 活動量 ふつう',
    '活動量の例: 低い / ふつう / やや高い / 高い',
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