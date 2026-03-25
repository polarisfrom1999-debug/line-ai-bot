'use strict';

const {
  parseProfile,
  calculateBMR,
  calculateTDEE,
  profileGuideMessage,
} = require('../parsers/profile_parser');
const { fmt } = require('../utils/formatters');

function activityLevelLabel(activityLevel) {
  if (activityLevel === 'high') return '高い';
  if (activityLevel === 'moderate_high') return 'やや高い';
  if (activityLevel === 'moderate') return 'ふつう';
  if (activityLevel === 'low') return '低い';
  return null;
}

function sexLabel(sex) {
  if (sex === 'male') return '男性';
  if (sex === 'female') return '女性';
  return null;
}

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function round1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function round0(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function parseLooseProfile(text = '', currentUser = {}) {
  const raw = safeText(text);
  if (!raw) return {};

  const updates = { ...parseProfile(raw) };
  const t = raw.replace(/\s+/g, '');

  if (!updates.age) {
    const m = raw.match(/(\d{1,3})\s*(歳|才)/);
    const age = m ? Number(m[1]) : null;
    if (Number.isFinite(age) && age >= 1 && age <= 120) updates.age = round0(age);
  }

  if (!updates.height_cm) {
    let m = raw.match(/身長\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (!m) m = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*(cm|センチ)/i);
    const height = m ? Number(m[1]) : null;
    if (Number.isFinite(height) && height >= 100 && height <= 250) updates.height_cm = round1(height);
  }

  if (!updates.weight_kg) {
    let m = raw.match(/体重\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (!m) m = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*(kg|ｋｇ|キロ)/i);
    const weight = m ? Number(m[1]) : null;
    if (Number.isFinite(weight) && weight >= 20 && weight <= 300) updates.weight_kg = round1(weight);
  }

  if (!updates.target_weight_kg) {
    const m = raw.match(/目標体重\s*([0-9]+(?:\.[0-9]+)?)/i);
    const target = m ? Number(m[1]) : null;
    if (Number.isFinite(target) && target >= 20 && target <= 300) updates.target_weight_kg = round1(target);
  }

  if (!updates.sex) {
    if (/女性|女/.test(raw)) updates.sex = 'female';
    else if (/男性|男/.test(raw)) updates.sex = 'male';
  }

  if (!updates.activity_level) {
    if (/活動量.*高い|かなり動く|よく動く/.test(raw)) updates.activity_level = 'high';
    else if (/活動量.*やや高い|週3回以上/.test(raw)) updates.activity_level = 'moderate_high';
    else if (/活動量.*ふつう|週1.?2回|たまに動く/.test(raw)) updates.activity_level = 'moderate';
    else if (/活動量.*低い|ほぼ運動なし|あまり動かない/.test(raw)) updates.activity_level = 'low';
  }

  if (!Object.keys(updates).length) {
    const numberOnly = t.match(/^([0-9]+(?:\.[0-9]+)?)$/);
    if (numberOnly) {
      const n = Number(numberOnly[1]);
      if (!currentUser.age && n >= 1 && n <= 120) updates.age = round0(n);
      else if (!currentUser.height_cm && n >= 100 && n <= 250) updates.height_cm = round1(n);
      else if (n >= 20 && n <= 300) updates.weight_kg = round1(n);
    }
  }

  return updates;
}

function buildProfileUpdatePayload(currentUser, text) {
  const updates = parseLooseProfile(text, currentUser);
  if (!Object.keys(updates).length) return null;

  const previewUser = { ...currentUser, ...updates };
  const estimated_bmr = calculateBMR(previewUser);
  const estimated_tdee = calculateTDEE(previewUser);

  return {
    ...updates,
    estimated_bmr,
    estimated_tdee,
  };
}

function buildProfileReply(user) {
  const lines = [
    'プロフィールを更新しました。',
    user.sex ? `性別: ${sexLabel(user.sex)}` : null,
    user.age ? `年齢: ${fmt(user.age)}` : null,
    user.height_cm ? `身長: ${fmt(user.height_cm)} cm` : null,
    user.weight_kg ? `体重: ${fmt(user.weight_kg)} kg` : null,
    user.target_weight_kg ? `目標体重: ${fmt(user.target_weight_kg)} kg` : null,
    user.activity_level ? `活動量: ${activityLevelLabel(user.activity_level) || user.activity_level}` : null,
    user.estimated_bmr ? `推定基礎代謝: ${fmt(user.estimated_bmr)} kcal/日` : null,
    user.estimated_tdee ? `推定総消費目安: ${fmt(user.estimated_tdee)} kcal/日` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  profileGuideMessage,
  activityLevelLabel,
  sexLabel,
  buildProfileUpdatePayload,
  buildProfileReply,
  parseLooseProfile,
};
