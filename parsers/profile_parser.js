'use strict';

const { round0, round1 } = require('../utils/formatters');

function safeText(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return safeText(value)
    .replace(/[、，,\/／]/g, ' ')
    .replace(/[()（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLoose(value) {
  return safeText(value)
    .toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[!！?？。、,.，\/／]/g, '');
}

function findLabeledNumber(text, patterns = []) {
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseSex(text) {
  const raw = safeText(text);
  if (!raw) return null;
  if (/(性別\s*[:：は=]?\s*男性|性別\s*[:：は=]?\s*男|\b男性\b|\b男\b)/.test(raw)) return 'male';
  if (/(性別\s*[:：は=]?\s*女性|性別\s*[:：は=]?\s*女|\b女性\b|\b女\b)/.test(raw)) return 'female';
  return null;
}

function parseAge(text) {
  return findLabeledNumber(text, [/年齢\s*[:：は=]?\s*(-?\d+(?:\.\d+)?)/i, /(-?\d+(?:\.\d+)?)\s*(?:歳|才)/i]);
}

function parseHeight(text) {
  return findLabeledNumber(text, [/身長\s*[:：は=]?\s*(-?\d+(?:\.\d+)?)/i, /身長\s*[:：は=]?\s*(-?\d+(?:\.\d+)?)\s*(?:cm|ｃｍ)/i]);
}

function parseWeight(text) {
  return findLabeledNumber(text, [/(?:現在)?体重\s*[:：は=]?\s*(-?\d+(?:\.\d+)?)/i]);
}

function parseTargetWeight(text) {
  return findLabeledNumber(text, [/目標体重\s*[:：は=]?\s*(-?\d+(?:\.\d+)?)/i, /目標\s*[:：は=]?\s*(-?\d+(?:\.\d+)?)(?:\s*(?:kg|ｋｇ|キロ))?/i]);
}

function parseActivityLevel(text) {
  const t = normalizeLoose(text);
  if (!t) return null;
  if (t.includes('活動量高い') || t.includes('活動量激しい') || t.includes('活動量多い') || t.includes('日常活動量高い') || t.includes('仕事でよく動く') || t.includes('かなり動く') || t.includes('激しい')) return 'high';
  if (t.includes('活動量やや高い') || t.includes('日常活動量やや高い') || t.includes('週3回以上') || t.includes('よく動く')) return 'moderate_high';
  if (t.includes('活動量ふつう') || t.includes('活動量普通') || t.includes('日常活動量ふつう') || t.includes('日常活動量普通') || t.includes('たまに動く') || t.includes('週1〜2回') || t.includes('週1-2回') || t.includes('普通') || t.includes('ふつう')) return 'moderate';
  if (t.includes('活動量低い') || t.includes('日常活動量低い') || t.includes('ほぼ運動なし') || t.includes('あまり動かない') || t.includes('低い')) return 'low';
  return null;
}

function parseProfile(text) {
  const result = {};
  const raw = normalizeText(text);
  if (!raw) return result;

  const sex = parseSex(raw);
  if (sex) result.sex = sex;

  const age = parseAge(raw);
  if (age != null) result.age = round0(age);

  const height = parseHeight(raw);
  if (height != null) result.height_cm = round1(height);

  const weight = parseWeight(raw);
  if (weight != null) result.weight_kg = round1(weight);

  const target = parseTargetWeight(raw);
  if (target != null) result.target_weight_kg = round1(target);

  const activityLevel = parseActivityLevel(raw);
  if (activityLevel) result.activity_level = activityLevel;

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
  if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(a)) return null;
  return user.sex === 'male' ? round1(10 * w + 6.25 * h - 5 * a + 5) : round1(10 * w + 6.25 * h - 5 * a - 161);
}

function calculateTDEE(user) {
  const bmr = calculateBMR(user);
  if (!bmr) return null;
  return round1(bmr * getActivityMultiplier(user.activity_level));
}

function profileGuideMessage() {
  return [
    '例: プロフィール 性別 女性 年齢 55 身長 160 体重 63 目標 58 活動量 ふつう',
    '活動量の例: 低い / ふつう / やや高い / 高い / 激しい',
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
