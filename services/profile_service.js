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

function parseLooseProfileText(text = '') {
  const raw = safeText(text);
  if (!raw) return null;

  const direct = parseProfile(raw);
  if (Object.keys(direct).length) return direct;

  const result = {};
  const ageOnly = raw.match(/^(年齢)?\s*(\d{1,3})\s*歳?$/);
  if (ageOnly) result.age = Number(ageOnly[2]);

  const heightOnly = raw.match(/^(身長)?\s*(\d{2,3}(?:\.\d+)?)\s*(cm|ｃｍ)?$/i);
  if (heightOnly) result.height_cm = Number(heightOnly[2]);

  const targetOnly = raw.match(/^(目標体重)?\s*(\d{2,3}(?:\.\d+)?)\s*(kg|ｋｇ|キロ)?$/i);
  if (targetOnly && /目標/.test(raw)) result.target_weight_kg = Number(targetOnly[2]);

  if (/^(男性|男)$/.test(raw)) result.sex = 'male';
  if (/^(女性|女)$/.test(raw)) result.sex = 'female';

  if (/^(低い|ふつう|やや高い|高い)$/.test(raw)) {
    if (raw === '低い') result.activity_level = 'low';
    if (raw === 'ふつう') result.activity_level = 'moderate';
    if (raw === 'やや高い') result.activity_level = 'moderate_high';
    if (raw === '高い') result.activity_level = 'high';
  }

  return Object.keys(result).length ? result : null;
}

function buildProfileUpdatePayload(currentUser, text) {
  const updates = parseLooseProfileText(text) || {};
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

function buildProfileReply(user, updatedKeys = []) {
  const keySet = new Set(updatedKeys || []);
  const lines = ['プロフィールを更新しました。'];

  if (!updatedKeys.length || keySet.has('sex')) lines.push(user.sex ? `性別: ${sexLabel(user.sex)}` : null);
  if (!updatedKeys.length || keySet.has('age')) lines.push(user.age ? `年齢: ${fmt(user.age)}` : null);
  if (!updatedKeys.length || keySet.has('height_cm')) lines.push(user.height_cm ? `身長: ${fmt(user.height_cm)} cm` : null);
  if (!updatedKeys.length || keySet.has('weight_kg')) lines.push(user.weight_kg ? `体重: ${fmt(user.weight_kg)} kg` : null);
  if (!updatedKeys.length || keySet.has('target_weight_kg')) lines.push(user.target_weight_kg ? `目標体重: ${fmt(user.target_weight_kg)} kg` : null);
  if (!updatedKeys.length || keySet.has('activity_level')) lines.push(user.activity_level ? `活動量: ${activityLevelLabel(user.activity_level) || user.activity_level}` : null);
  if (user.estimated_bmr) lines.push(`推定基礎代謝: ${fmt(user.estimated_bmr)} kcal/日`);
  if (user.estimated_tdee) lines.push(`推定総消費目安: ${fmt(user.estimated_tdee)} kcal/日`);

  return lines.filter(Boolean).join('\n');
}

module.exports = {
  profileGuideMessage,
  activityLevelLabel,
  sexLabel,
  parseLooseProfileText,
  buildProfileUpdatePayload,
  buildProfileReply,
};
