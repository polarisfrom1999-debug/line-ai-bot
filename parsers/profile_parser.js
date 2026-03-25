'use strict';

const { round0, round1 } = require('../utils/formatters');

function parseActivityLevel(text = '') {
  const t = String(text || '');
  if (/激しい|高い|かなり動く|仕事でよく動く/.test(t)) return 'high';
  if (/やや高い|よく動く|週3/.test(t)) return 'moderate_high';
  if (/ふつう|普通|週1|週2/.test(t)) return 'moderate';
  if (/低い|あまり動かない|ほぼ運動なし/.test(t)) return 'low';
  return null;
}

function captureNumber(text, patterns = []) {
  for (const pattern of patterns) {
    const m = String(text || '').match(pattern);
    if (m) return Number(m[1]);
  }
  return null;
}

function parseProfile(text = '') {
  const result = {};
  const raw = String(text || '').trim();

  if (/(男性|男)/.test(raw)) result.sex = 'male';
  else if (/(女性|女)/.test(raw)) result.sex = 'female';

  const age = captureNumber(raw, [/年齢\s*[:：]?\s*(\d+(?:\.\d+)?)/, /^(\d{1,3})歳$/, /(\d{1,3})歳/]);
  if (age != null) result.age = round0(age);

  const height = captureNumber(raw, [/身長\s*[:：]?\s*(\d+(?:\.\d+)?)/, /(\d+(?:\.\d+)?)\s*cm/i]);
  if (height != null) result.height_cm = round1(height);

  const weight = captureNumber(raw, [/体重\s*[:：]?\s*(\d+(?:\.\d+)?)/, /^(\d{2,3}(?:\.\d+)?)\s*(?:kg|ｋｇ|キロ)$/i]);
  if (weight != null) result.weight_kg = round1(weight);

  const target = captureNumber(raw, [/目標体重\s*[:：]?\s*(\d+(?:\.\d+)?)/, /目標\s*[:：]?\s*(\d+(?:\.\d+)?)/, /目標\s*(\d+(?:\.\d+)?)\s*(?:kg|ｋｇ|キロ)?/i]);
  if (target != null) result.target_weight_kg = round1(target);

  const activity = parseActivityLevel(raw);
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
    'プロフィール変更ですね。',
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
