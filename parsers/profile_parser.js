'use strict';

function toNumber(text, pattern) {
  const m = String(text || '').match(pattern);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseActivityLevel(text = '') {
  const t = String(text || '');
  if (/激しい|高い|かなり動く/.test(t)) return 'high';
  if (/やや高い|よく動く/.test(t)) return 'moderate_high';
  if (/ふつう|普通/.test(t)) return 'moderate';
  if (/低い|あまり動かない/.test(t)) return 'low';
  return null;
}

function parseProfile(text = '') {
  const t = String(text || '');
  const result = {};
  if (/男性|\b男\b/.test(t)) result.sex = 'male';
  if (/女性|\b女\b/.test(t)) result.sex = 'female';
  const age = toNumber(t, /年齢\s*([0-9]+(?:\.[0-9]+)?)/);
  if (age != null) result.age = Math.round(age);
  const height = toNumber(t, /身長\s*([0-9]+(?:\.[0-9]+)?)/);
  if (height != null) result.height_cm = Math.round(height * 10) / 10;
  const weight = toNumber(t, /体重\s*([0-9]+(?:\.[0-9]+)?)/);
  if (weight != null) result.weight_kg = Math.round(weight * 10) / 10;
  const target = toNumber(t, /目標(?:体重)?\s*([0-9]+(?:\.[0-9]+)?)/);
  if (target != null) result.target_weight_kg = Math.round(target * 10) / 10;
  const activity = parseActivityLevel(t);
  if (activity) result.activity_level = activity;
  return result;
}

function getActivityMultiplier(level) {
  if (level === 'high') return 1.75;
  if (level === 'moderate_high') return 1.55;
  if (level === 'moderate') return 1.375;
  return 1.2;
}

function calculateBMR(user = {}) {
  if (!user.sex || !user.age || !user.height_cm || !user.weight_kg) return null;
  const w = Number(user.weight_kg); const h = Number(user.height_cm); const a = Number(user.age);
  return user.sex === 'male' ? Math.round((10 * w + 6.25 * h - 5 * a + 5) * 10) / 10 : Math.round((10 * w + 6.25 * h - 5 * a - 161) * 10) / 10;
}

function calculateTDEE(user = {}) {
  const bmr = calculateBMR(user);
  if (bmr == null) return null;
  return Math.round(bmr * getActivityMultiplier(user.activity_level) * 10) / 10;
}

module.exports = { parseProfile, parseActivityLevel, calculateBMR, calculateTDEE };
